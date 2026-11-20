import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mapsLocation } from '../maps.js';
import { openStore, refreshReminders } from '../store.js';

test('a scheduled task produces one reminder in the 30-minute window', () => {
  const db = openStore(new DatabaseSync(':memory:'));
  const start = Date.parse('2026-11-20T10:00:00Z');
  const minute = 60_000;
  db.exec("INSERT INTO employees (id, name, role, email, color) VALUES (1, 'Employee', 'Photographer', 'staff@example.com', 'peach')");
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, employee_id, start_at, estimate, location, category, completed_at, is_open)
    VALUES (?, ?, 1, ?, 90, 'Studio A', 'Photo shoot', ?, ?)
  `);
  insertTask.run(1, 'Upcoming shoot', start, null, 0);
  insertTask.run(2, 'Early delivery', start, start - 31 * minute, 0);
  insertTask.run(3, 'Unassigned', start, null, 1);
  const reminders = () => db.prepare('SELECT task_id, employee_id, sent_at FROM reminders').all();
  refreshReminders(db, start - 30 * minute - 1);
  assert.equal(reminders().length, 0);
  refreshReminders(db, start - 30 * minute);
  refreshReminders(db, start - 10 * minute);
  assert.deepEqual(reminders().map((row) => ({ ...row })), [
    { task_id: 1, employee_id: 1, sent_at: start - 30 * minute },
  ]);
  db.close();
});

test('Maps parsing prefers the pin, handles share redirects, and rejects external targets', async () => {
  const pin = 'https://www.google.com/maps/place/Studio/@17.38,78.48,17z/data=!3d17.385!4d78.4867';
  assert.deepEqual(await mapsLocation({ mapsUrl: pin }), { maps_url: pin, latitude: 17.385, longitude: 78.4867 });
  const short = 'https://maps.app.goo.gl/Example';
  const redirect = () => Promise.resolve(new Response(null, { status: 302, headers: { location: pin } }));
  assert.deepEqual(await mapsLocation({ mapsUrl: short }, redirect), { maps_url: short, latitude: 17.385, longitude: 78.4867 });
  let hops = 0;
  await assert.rejects(mapsLocation({ mapsUrl: short }, async () => {
    hops += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
  }), /does not expose a GPS pin/);
  assert.equal(hops, 1);
  await assert.rejects(mapsLocation({ mapsUrl: 'https://example.net/maps?query=0,0', latitude: '0', longitude: '0' }), /Google Maps/);
});

test('admin setup, assignment access, approvals, ledger, and GPS survive a restart', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'concept-workforce-'));
  const database = join(directory, 'workforce.sqlite');
  let server;
  let base;
  t.after(async () => {
    await stopServer();
    await rm(directory, { recursive: true, force: true });
  });

  async function stopServer() {
    if (server && server.exitCode === null && server.signalCode === null) {
      const done = once(server, 'exit');
      server.kill();
      await done;
    }
  }

  async function startServer() {
    const { ADMIN_SETUP_TOKEN: ignoredToken, ...env } = process.env;
    server = spawn(process.execPath, ['server.js'], {
      env: { ...env, HOST: '127.0.0.1', PORT: '0', DATABASE_PATH: database },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    base = await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`Server exited during startup: ${code}`)));
      server.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
  }

  function client() {
    let cookie;
    return async (path, body, expected = 200, extraHeaders = {}) => {
      const headers = { ...extraHeaders, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
      const response = await fetch(`${base}/api/${path}`, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
      const newCookie = response.headers.get('set-cookie');
      if (newCookie) {
        assert.match(newCookie, /HttpOnly; SameSite=Strict/);
        cookie = newCookie.split(';')[0];
      }
      const payload = await response.json();
      assert.equal(response.status, expected, JSON.stringify(payload));
      return payload;
    };
  }

  await startServer();
  const guest = client();
  await guest('state', null, 401);
  assert.equal((await guest('session')).needsSetup, true);
  const admin = client();
  const adminCredentials = { name: 'Studio Admin', email: 'admin@example.com', password: 'Admin example passphrase' };
  await admin('bootstrap', adminCredentials);
  await guest('bootstrap', adminCredentials, 409);
  const empty = await admin('state');
  assert.equal(empty.employees.length, 1);
  assert.deepEqual(empty.tasks, []);
  assert.equal(empty.office, null);
  assert.ok(empty.actor.is_admin);
  assert.equal('password_hash' in empty.employees[0], false);
  assert.equal('password_hash' in empty.actor, false);

  const credentials = { email: 'staff@example.com', password: 'Employee test passphrase' };
  const photographer = await admin('employees', { ...credentials, name: 'Team Member', role: 'Photographer', phone: '+91 98765 43210' });
  const colleague = await admin('employees', { email: 'other@example.com', password: 'Other test passphrase', name: 'Other Member', role: 'Assistant' });
  const staff = client();
  const other = client();
  await staff('login', credentials);
  await other('login', { email: colleague.email, password: 'Other test passphrase' });
  await staff('employees', { actorId: empty.actor.id, id: photographer.id }, 403);
  await staff('office', { actorId: empty.actor.id }, 403);
  await admin('employees', { ...photographer, name: 'Lead Team Member' });
  assert.equal((await staff('state')).actor.name, 'Lead Team Member');
  const office = { latitude: 17.385, longitude: 78.4867, accuracy: 8 };
  const shootCoords = { ...office, latitude: 17.388 };
  const maps = (location) => `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  await admin('office', { name: 'Office', mapsUrl: maps(office) }, 403, { Origin: 'https://other.example.com' });
  await admin('office', { name: 'Office', mapsUrl: maps(office) });

  const createShoot = {
    employeeId: photographer.id, title: 'Portrait shoot', location: 'Courtyard', category: 'Photo shoot',
    estimate: 90, startAt: new Date(Date.now() + 10 * 60_000).toISOString(), mapsUrl: maps(shootCoords),
    clientName: 'Client Owner', clientPhone: '+91 99999 11111', income: '12000.50',
  };
  const assigned = await admin('tasks', createShoot);
  const open = await admin('tasks', { ...createShoot, assignment: 'open', title: 'Open shoot' });
  assert.equal(assigned.priority, 1);
  assert.equal(open.is_open, 1);
  const before = await staff('state');
  assert.deepEqual(before.tasks.map((task) => task.id), [assigned.id]);
  assert.equal(before.tasks[0].client_name, 'Client Owner');
  assert.equal('income_paise' in before.tasks[0], false);
  assert.equal('clients' in before, false);
  assert.equal('payments' in before, false);
  assert.equal(before.employees.length, 1);
  assert.equal(before.openWork[0].id, open.id);
  assert.equal('maps_url' in before.openWork[0], false);
  await staff('task-action', { taskId: open.id, action: 'complete' }, 403);
  await other('task-action', { taskId: assigned.id, employeeId: photographer.id, action: 'start' }, 403);

  const request = await staff('work-requests', { taskId: open.id, note: 'Available for the shoot' });
  const competing = await other('work-requests', { taskId: open.id });
  await staff('work-requests', { taskId: open.id }, 409);
  await staff('request-decisions', { id: request.id, status: 'approved' }, 403);
  assert.equal((await staff('state')).tasks.length, 1);
  await admin('request-decisions', { id: request.id, status: 'approved' });
  await admin('request-decisions', { id: competing.id, status: 'approved' }, 409);
  const after = await staff('state');
  assert.equal(after.tasks.length, 2);
  assert.ok(after.tasks.every((task) => task.priority && task.client_name === 'Client Owner'));
  assert.equal(after.openWork.length, 0);
  assert.equal((await other('state')).requests[0].status, 'declined');

  const clock = (api, action, location, body = {}, expected = 200) => api('attendance', {
    action, location: location && { ...location, capturedAt: Date.now() }, ...body,
  }, expected);
  await clock(staff, 'in', null, {}, 400);
  await clock(other, 'in', shootCoords, { taskId: assigned.id, employeeId: photographer.id }, 403);
  await clock(staff, 'in', office, { taskId: assigned.id }, 422);
  await clock(staff, 'in', { ...office, accuracy: 100 }, {}, 422);
  const shift = await clock(staff, 'in', shootCoords, { taskId: assigned.id, employeeId: colleague.id });
  assert.equal(shift.employee_id, photographer.id);
  assert.equal(JSON.parse(shift.site).taskId, assigned.id);
  const nearEdge = { ...shootCoords, latitude: 17.38892 };
  assert.equal(await clock(staff, 'observe', nearEdge, { shiftId: shift.id }), null);
  await clock(staff, 'out', office, { shiftId: shift.id }, 422);
  const departure = await clock(staff, 'observe', office, { shiftId: shift.id });
  assert.equal(departure.out_reason, 'geofence');
  assert.equal(departure.resume_pending, 1);
  assert.ok((await staff('state')).sessions.every((entry) => entry.end_at !== null));
  assert.equal(await clock(staff, 'observe', shootCoords, { shiftId: shift.id + 1 }), null);
  const returned = await clock(staff, 'observe', shootCoords, { shiftId: shift.id });
  assert.equal(returned.in_reason, 'geofence');
  await staff('task-action', { taskId: assigned.id, action: 'complete' });
  await clock(staff, 'out', shootCoords, { shiftId: returned.id });

  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
  const payment = await admin('payments', { taskId: assigned.id, amount: '1000.50', date, note: 'Deposit' });
  assert.equal(payment.amount_paise, 100050);
  await admin('payments', { taskId: assigned.id, amount: '11000.01', date }, 400);
  await admin('payments', { id: payment.id, amount: '1000.50', date, note: 'Corrected deposit reference' });
  const expense = await admin('expenses', { name: 'Travel', category: 'Transport', amount: '200', date });
  await admin('expenses', { id: expense.id, name: 'Travel', category: 'Transport', amount: '250.25', date });
  await staff('payments', { taskId: assigned.id, amount: '50', date }, 403);
  await admin('employees', { ...photographer, name: 'Lead Team Member', password: 'Rotated example passphrase' });
  await staff('state', null, 401);
  await staff('login', credentials, 401);
  await staff('login', { ...credentials, password: 'Rotated example passphrase' });

  await stopServer();
  await startServer();
  const saved = await admin('state');
  assert.equal(saved.office.name, 'Office');
  assert.equal(saved.clients.length, 1);
  assert.equal(saved.tasks.find((task) => task.id === assigned.id).income_paise, 1200050);
  assert.deepEqual(saved.payments.map((item) => item.amount_paise), [100050]);
  assert.deepEqual(saved.expenses.map((item) => item.amount_paise), [25025]);
  assert.equal(saved.sessions.length, 2);
  assert.ok(saved.sessions.every((entry) => entry.end_at >= entry.start_at));
  assert.equal(saved.attendance.length, 2);
  assert.equal((await staff('state')).tasks.length, 2);
  await staff('logout', {});
  await staff('state', null, 401);
});
