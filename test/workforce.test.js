import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../lib/workspace-api.js';
import { studioDay, dayStart, dayLength, weekday, leaveLedger, timeForDay } from '../lib/hr-policy.js';
import { formatCalendar } from '../lib/calendar.js';
import { hashPassword } from '../lib/accounts.js';
import { mapsLocation } from '../lib/maps.js';
import { refreshReminders } from '../lib/reminders.js';
import { createMobilePush } from '../lib/mobile-push.js';
import { financeCsv, financeReport } from '../public/finance-report.js';
import { openStore } from '../store.js';
import { sqliteAdapter } from '../sqlite-adapter.js';

test('a scheduled task produces one reminder in the 30-minute window', async () => {
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
  await refreshReminders(sqliteAdapter(db), start - 30 * minute - 1);
  assert.equal(reminders().length, 0);
  await refreshReminders(sqliteAdapter(db), start - 30 * minute);
  await refreshReminders(sqliteAdapter(db), start - 10 * minute);
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

test('monthly finance reports separate cash dates from shoot balances and escape CSV text', () => {
  const state = {
    tasks: [
      { id: 1, category: 'Photo shoot', start_at: Date.parse('2026-11-30T19:00:00Z'), title: '=Portrait',
        income_paise: 100000, payment_due_on: '2026-12-02' },
      { id: 2, category: 'Photo shoot', start_at: dayStart('2026-11-20'), title: 'Cancelled',
        income_paise: 100000, payment_due_on: '2026-11-26', shoot_status: 'cancelled' },
    ],
    payments: [
      { task_id: 1, paid_on: '2026-11-28', amount_paise: 10000 },
      { task_id: 1, paid_on: '2026-12-01', amount_paise: 20000 },
    ],
    expenses: [{ name: 'Taxi, "pickup"', spent_on: '2026-12-01', amount_paise: 25050, note: ' +Example' }],
  };
  const report = financeReport(state, '2026-12', '2026-12-03', studioDay);
  assert.deepEqual(report.shoots.map(({ task }) => task.id), [1]);
  assert.equal(report.received, 20000);
  assert.equal(report.outstanding, 70000);
  assert.equal(report.net, -5050);
  assert.deepEqual(report.overdue.map(({ task }) => task.id), [1]);
  assert.equal(financeReport(state, '2026-12', '2026-12-02', studioDay).overdue.length, 0);
  const csv = financeCsv(report, '2026-12', state.tasks);
  assert.match(csv, /"'=Portrait"/);
  assert.match(csv, /"Taxi, ""pickup"""/);
  assert.match(csv, /"' \+Example"/);
  assert.match(csv, /"Overdue balance"/);
  assert.doesNotMatch(csv, /2026-11-28|Cancelled/);
});

test('a test reminder uses only the signed-in device subscription and enforces a cooldown', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/example';
    database.exec(`
      CREATE TABLE push_subscriptions(id INTEGER PRIMARY KEY, employee_id INTEGER, endpoint TEXT, p256dh TEXT, auth_secret TEXT, last_test_at INTEGER);
      CREATE TABLE push_settings(id INTEGER PRIMARY KEY, vapid_public_key TEXT, vapid_private_key TEXT);
      INSERT INTO push_settings VALUES (1, 'public-test', 'private-test');
    `);
    database.prepare('INSERT INTO push_subscriptions VALUES (1, 2, ?, ?, ?, NULL)').run(endpoint, 'device-public', 'device-auth');
    const db = sqliteAdapter(database);
    const payloads = [];
    let status = 201;
    const sender = createMobilePush({
      generateRequestDetails(subscription, payload) {
        assert.equal(subscription.endpoint, endpoint);
        payloads.push(JSON.parse(payload));
        return { endpoint, method: 'POST', body: payload };
      },
    }, 'https://example.invalid', async () => new Response(null, { status }));
    await assert.rejects(sender.testDevice(db, 3, endpoint), { status: 409 });
    assert.deepEqual(await sender.testDevice(db, 2, endpoint), { ok: true });
    assert.equal(payloads[0].tag, 'concept-device-test');
    await assert.rejects(sender.testDevice(db, 2, endpoint), { status: 429 });
    database.exec('UPDATE push_subscriptions SET last_test_at = 0');
    status = 410;
    await assert.rejects(sender.testDevice(db, 2, endpoint), { status: 410 });
    assert.equal(database.prepare('SELECT COUNT(*) AS total FROM push_subscriptions').get().total, 0);
    assert.equal(payloads.length, 2);
  } finally {
    database.close();
  }
});

test('workspace roles, personnel requests, crew attendance, payroll, and financial records survive a restart', { timeout: 15000 }, async (t) => {
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
    server = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATABASE_PATH: database },
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

  const adminCredentials = { email: 'admin@example.com', password: 'Admin example passphrase' };
  const provision = spawn(process.execPath, ['scripts/create-local-admin.js', adminCredentials.email], {
    env: { ...process.env, DATABASE_PATH: database },
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  const provisioned = once(provision, 'exit');
  provision.stdin.end(adminCredentials.password);
  assert.equal((await provisioned)[0], 0);
  await startServer();

  const document = await (await fetch(base)).text();
  assert.match(document, /<h1 id="access-title">Sign in<\/h1>/);
  assert.match(document, /name="email" type="email"/);
  assert.match(document, /name="password" type="password"/);
  assert.doesNotMatch(document, /Admin Dashboard|[Ss]etup token|[Ss]et up the first admin/);
  assert.equal((await fetch(base + '/finance-report.js')).status, 200);
  assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
  const guest = client();
  await guest('state', null, 401);
  assert.deepEqual(await guest('session'), { actor: null });
  const admin = client();
  await admin('login', adminCredentials);
  await admin('bootstrap', adminCredentials, 404);
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
  const secondStop = { ...office, latitude: 17.391 };
  const maps = (location) => `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  await admin('office', { name: 'Office', mapsUrl: maps(office) }, 403, { Origin: 'https://other.example.com' });
  await admin('office', { name: 'Office', mapsUrl: maps(office) });

  const createShoot = {
    employeeId: photographer.id, title: 'Portrait shoot', location: 'Courtyard', category: 'Photo shoot',
    estimate: 90, startAt: new Date(Date.now() + 10 * 60_000).toISOString(), mapsUrl: maps(shootCoords),
    clientName: 'Client Owner', clientPhone: '+91 99999 11111', income: '12000.50',
  };
  const additionalSites = [{ name: 'Rooftop', mapsUrl: maps(secondStop) }];
  const assigned = await admin('tasks', { ...createShoot, additionalSites });
  await admin('tasks', { ...createShoot, id: assigned.id, additionalSites: [{ mapsUrl: maps(shootCoords) }] }, 400);
  await admin('tasks', { ...createShoot, id: assigned.id, additionalSites: [{ mapsUrl: 'https://example.net/maps?query=0,0' }] }, 400);
  const open = await admin('tasks', { ...createShoot, assignment: 'open', title: 'Open shoot' });
  const personalCalendar = await staff('calendar/issue', {});
  assert.equal(new URL(personalCalendar.url).origin, base);
  const feed = await fetch(personalCalendar.url);
  assert.equal(feed.headers.get('cache-control'), 'private, no-store');
  const ics = await feed.text();
  assert.match(ics, /SUMMARY:Portrait shoot/);
  assert.match(ics, /LOCATION:Courtyard \/ Rooftop/);
  assert.doesNotMatch(ics, /SUMMARY:Open shoot/);
  await staff('calendar/revoke', {});
  assert.equal((await fetch(personalCalendar.url)).status, 404);
  assert.equal(assigned.priority, 1);
  assert.equal(open.is_open, 1);
  const before = await staff('state');
  assert.deepEqual(before.tasks.map((task) => task.id), [assigned.id]);
  assert.deepEqual(JSON.parse(before.tasks[0].additional_sites), [{
    name: 'Rooftop', maps_url: maps(secondStop), latitude: secondStop.latitude, longitude: secondStop.longitude,
  }]);
  assert.equal(before.tasks[0].client_name, 'Client Owner');
  assert.equal('income_paise' in before.tasks[0], false);
  assert.equal('clients' in before, false);
  assert.equal('payments' in before, false);
  assert.equal(before.employees.length, 1);
  assert.equal(before.openWork[0].id, open.id);
  assert.equal('maps_url' in before.openWork[0], false);
  assert.equal('additional_sites' in before.openWork[0], false);
  await staff('task-action', { taskId: open.id, action: 'complete' }, 403);
  await other('task-action', { taskId: assigned.id, employeeId: photographer.id, action: 'start' }, 403);

  const request = await staff('work-requests', { taskId: open.id, note: 'Available for the shoot' });
  const competing = await other('work-requests', { taskId: open.id });
  await staff('work-requests', { taskId: open.id }, 409);
  await staff('request-decisions', { id: request.id, status: 'approved' }, 403);
  assert.equal((await staff('state')).tasks.length, 1);
  const requestWarning = await admin('request-decisions', { id: request.id, status: 'approved' }, 409);
  assert.equal(requestWarning.conflicts[0].title, assigned.title);
  await admin('request-decisions', { id: request.id, status: 'approved', acknowledgedConflicts: requestWarning.conflicts.map(({ key }) => key) });
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
  await clock(other, 'in', secondStop, { taskId: assigned.id, employeeId: photographer.id }, 403);
  await clock(staff, 'in', office, { taskId: assigned.id }, 422);
  await clock(staff, 'in', { ...office, accuracy: 100 }, {}, 422);
  const shift = await clock(staff, 'in', secondStop, { taskId: assigned.id, employeeId: colleague.id });
  assert.equal(shift.employee_id, photographer.id);
  assert.equal(JSON.parse(shift.site).taskId, assigned.id);
  assert.equal(JSON.parse(shift.site).name, 'Rooftop');
  await admin('tasks', { ...createShoot, id: assigned.id, additionalSites: [] }, 409);
  const nearEdge = { ...secondStop, latitude: 17.39192 };
  assert.equal(await clock(staff, 'observe', nearEdge, { shiftId: shift.id }), null);
  await clock(staff, 'out', shootCoords, { shiftId: shift.id }, 422);
  const departure = await clock(staff, 'observe', office, { shiftId: shift.id });
  assert.equal(departure.out_reason, 'geofence');
  assert.equal(departure.resume_pending, 1);
  assert.ok((await staff('state')).sessions.every((entry) => entry.end_at !== null));
  assert.equal(await clock(staff, 'observe', secondStop, { shiftId: shift.id + 1 }), null);
  assert.equal(await clock(staff, 'observe', shootCoords, { shiftId: shift.id }), null);
  const returned = await clock(staff, 'observe', secondStop, { shiftId: shift.id });
  assert.equal(returned.in_reason, 'geofence');
  assert.equal(JSON.parse(returned.site).name, 'Rooftop');
  const finished = await staff('task-action', { taskId: assigned.id, action: 'complete' });
  const correction = {
    ...createShoot, id: assigned.id, title: 'Portrait shoot (updated)', location: 'New courtyard name',
    startAt: '2026-11-21T23:00:00+05:30', endAt: '2026-11-22T02:30:00+05:30', mapsUrl: maps(office),
  };
  await admin('tasks', correction, 409);
  await clock(staff, 'out', secondStop, { shiftId: returned.id });
  const tracked = await staff('state');
  await staff('tasks', correction, 403);
  await admin('tasks', { ...correction, endAt: correction.startAt }, 400);
  await admin('tasks', { ...correction, endAt: '2026-11-22T23:01:00+05:30' }, 400);
  await admin('tasks', { ...correction, employeeId: colleague.id }, 409);
  await admin('tasks', { ...correction, shootStatus: 'cancelled' }, 409);
  const edited = await admin('tasks', correction);
  assert.equal(edited.completed_at, finished.completed_at);
  assert.equal(edited.start_at, Date.parse(correction.startAt));
  assert.equal(edited.estimate, 210);
  assert.equal(edited.site_latitude, office.latitude);
  assert.equal(edited.additional_sites, assigned.additional_sites);
  const afterEdit = await staff('state');
  assert.deepEqual(afterEdit.attendance, tracked.attendance);
  assert.deepEqual(afterEdit.sessions, tracked.sessions);
  assert.equal(afterEdit.tasks.find((task) => task.id === assigned.id).title, correction.title);
  assert.equal((await admin('tasks', { ...correction, additionalSites: [] })).additional_sites, '[]');

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

  const crewEnd = new Date(Date.parse(createShoot.startAt) + 75 * 60_000).toISOString();
  const crewBooking = { ...createShoot, title: 'Crew booking', crew: [colleague.id], endAt: crewEnd };
  const crewWarning = await admin('tasks', crewBooking, 409);
  assert.equal(crewWarning.conflicts[0].title, open.title);
  assert.equal(crewWarning.conflicts[0].employee_id, photographer.id);
  assert.equal((await admin('state')).tasks.some((task) => task.title === crewBooking.title), false);
  const acknowledgedConflicts = crewWarning.conflicts.map(({ key }) => key);
  const crew = await admin('tasks', { ...crewBooking, acknowledgedConflicts });
  assert.equal(crew.estimate, 75);
  const crewOverview = await other('state');
  assert.deepEqual(crewOverview.tasks[0].crew.map((entry) => entry.employee_id).sort(), [photographer.id, colleague.id].sort());
  assert.equal(crewOverview.reminders[0].task_id, crew.id);
  assert.ok((await staff('state')).reminders.some((entry) => entry.task_id === crew.id));
  await admin('tasks', { ...createShoot, title: crew.title, id: crew.id, shootStatus: 'postponed' });
  await clock(other, 'in', shootCoords, { taskId: crew.id }, 403);
  assert.equal((await other('state')).reminders.length, 0);
  await admin('tasks', { ...createShoot, title: crew.title, id: crew.id, shootStatus: 'booked', acknowledgedConflicts });
  assert.equal((await other('state')).reminders[0].task_id, crew.id);
  const crewShift = await clock(other, 'in', shootCoords, { taskId: crew.id });
  await admin('shoot-done', { taskId: crew.id }, 409);
  await other('task-action', { taskId: crew.id, action: 'complete' }, 409);
  await clock(other, 'out', shootCoords, { shiftId: crewShift.id });
  assert.ok((await admin('shoot-done', { taskId: crew.id })).completed_at);

  const handoff = { title: 'Edit crew photos', category: 'Editing', location: 'Office', parentShootId: crew.id,
    employeeId: colleague.id, startAt: '2026-12-09T11:00:00+05:30', endAt: '2026-12-09T13:15:00+05:30',
    deliveryDueAt: '2026-12-10T18:00:00+05:30' };
  await other('tasks', handoff, 403);
  await admin('tasks', { ...handoff, parentShootId: open.id }, 409);
  await admin('tasks', { ...handoff, deliveryDueAt: handoff.startAt }, 400);
  const editing = await admin('tasks', handoff);
  assert.equal(editing.parent_shoot_id, crew.id);
  assert.equal(editing.estimate, 135);
  assert.equal(editing.priority, 1);
  await admin('tasks', handoff, 409);
  const editorTask = (await other('state')).tasks.find((task) => task.id === editing.id);
  assert.equal(editorTask.source_shoot_title, crew.title);
  assert.equal(editorTask.delivery_due_at, Date.parse(handoff.deliveryDueAt));
  assert.equal('payment_due_on' in editorTask, false);
  await other('task-action', { taskId: editing.id, action: 'block', reason: 'Waiting for files' });

  const personal = await staff('tasks', { ...createShoot, title: 'Edit portraits', category: 'Editing', employeeId: colleague.id });
  assert.equal(personal.employee_id, photographer.id);
  assert.equal(personal.priority, 0);
  await staff('task-action', { taskId: personal.id, action: 'block', reason: 'Awaiting client selection.' });
  await staff('task-action', { taskId: personal.id, action: 'start' }, 409);
  await staff('task-action', { taskId: personal.id, action: 'unblock' });
  await staff('task-action', { taskId: personal.id, action: 'start' });
  await staff('task-action', { taskId: personal.id, action: 'complete' });
  await other('task-action', { taskId: personal.id, action: 'block', reason: 'Unassigned.' }, 403);

  const past = studioDay(dayStart(date) - dayLength);
  const future = [1, 2, 3].map((offset) => studioDay(dayStart(date) + offset * dayLength)).filter((day) => weekday(day) !== 0);
  await staff('hr/settings', { weekOff: 0, monthlyLeave: 3 }, 403);
  await admin('hr/settings', { weekOff: 0, monthlyLeave: 3, workStart: '09:00', workEnd: '18:00' });
  await admin('hr/holidays', { day: future[0], name: 'Studio closed' });
  await staff('hr/requests', { kind: 'leave', from: future[0], to: future[0], leaveType: 'casual', reason: 'Study day' }, 400);
  const leave = await staff('hr/requests', { kind: 'leave', from: future[1], to: future[1], leaveType: 'half', reason: 'Appointment' });
  await staff('hr/requests', { kind: 'leave', from: future[1], to: future[1], leaveType: 'half', reason: 'Duplicate' }, 409);
  await other('hr/review', { id: leave.id, status: 'cancelled' }, 404);
  await staff('hr/review', { id: leave.id, status: 'approved' }, 403);
  await admin('hr/review', { id: leave.id, status: 'approved' });
  const leaveWarning = await admin('tasks', { ...createShoot, employeeId: colleague.id,
    startAt: `${future[1]}T12:00:00+05:30`, title: 'Shoot during approved leave', crew: [photographer.id] }, 409);
  assert.deepEqual(leaveWarning.conflicts.map(({ employee_id, leave_type }) => [employee_id, leave_type]), [[photographer.id, 'half']]);
  await staff('payment-due', { taskId: assigned.id, paymentDueOn: past }, 403);
  await admin('payment-due', { taskId: assigned.id, paymentDueOn: '2026-02-30' }, 400);
  await admin('payment-due', { taskId: assigned.id, paymentDueOn: past });
  const adjustment = await staff('hr/requests', { kind: 'time', from: past, clockIn: '09:00', clockOut: '11:30', reason: 'Forgot to clock in.' });
  await admin('hr/review', { id: adjustment.id, status: 'approved' });
  const pending = await staff('hr/requests', { kind: 'time', from: past, clockIn: '08:30', reason: 'Check with lead.' });
  await staff('hr/review', { id: pending.id, status: 'cancelled' });

  await staff('hr/work-logs', { day: date, note: 'Prepared backup drive', minutes: 15, employeeId: colleague.id });
  await admin('hr/announcements', { title: 'Office update', message: 'The studio will open late after inventory.' });
  await staff('hr/payslips', { employeeId: colleague.id, period: date.slice(0, 7), gross: 1, deductions: 0 }, 403);
  await admin('hr/payslips', { employeeId: photographer.id, period: date.slice(0, 7), gross: '25000.50', deductions: '1000' });
  await admin('hr/payslips', { employeeId: colleague.id, period: date.slice(0, 7), gross: '15000', deductions: '0' });
  const ownHr = await staff('state');
  assert.deepEqual(ownHr.payslips.map((entry) => entry.gross_paise), [2500050]);
  assert.equal(ownHr.workLogs[0].employee_id, photographer.id);
  assert.equal(ownHr.announcements[0].title, 'Office update');
  const otherHr = await other('state');
  assert.deepEqual(otherHr.payslips.map((entry) => entry.gross_paise), [1500000]);
  assert.deepEqual(otherHr.hrRequests, []);
  assert.deepEqual(otherHr.workLogs, []);

  await stopServer();
  await startServer();
  const saved = await admin('state');
  assert.equal(saved.office.name, 'Office');
  assert.equal(saved.clients.length, 1);
  assert.equal(saved.tasks.find((task) => task.id === assigned.id).income_paise, 1200050);
  assert.equal(saved.tasks.find((task) => task.id === assigned.id).payment_due_on, past);
  assert.equal(saved.tasks.find((task) => task.id === editing.id).blocked_reason, 'Waiting for files');
  assert.deepEqual(saved.payments.map((item) => item.amount_paise), [100050]);
  assert.deepEqual(saved.expenses.map((item) => item.amount_paise), [25025]);
  assert.equal(saved.sessions.length, 4);
  assert.ok(saved.sessions.every((entry) => entry.end_at >= entry.start_at));
  assert.equal(saved.attendance.length, 3); // Corrections preserve GPS source records.
  assert.equal(saved.hrSettings.monthly_leave, 3);
  assert.equal(saved.holidays[0].day, future[0]);
  assert.equal(saved.hrRequests.find((entry) => entry.id === adjustment.id).status, 'approved');
  assert.equal(saved.hrRequests.find((entry) => entry.id === pending.id).status, 'cancelled');
  assert.equal(saved.payslips.length, 2);
  assert.equal((await staff('state')).tasks.length, 4);
  await staff('profile/notes', { note: 'My private planning notes' });
  assert.equal((await staff('profile')).note, 'My private planning notes');
  assert.equal((await admin('profile')).note, '');
  await staff('access-audit', null, 403);
  await admin('employees/access', { id: colleague.id, active: false });
  await other('state', null, 401);
  await other('login', { email: colleague.email, password: 'Other test passphrase' }, 401);
  assert.ok((await admin('state')).tasks.some((task) => task.id === editing.id));
  await admin('employees/access', { id: colleague.id, active: true });
  await other('login', { email: colleague.email, password: 'Other test passphrase' });
  await other('profile/password', { currentPassword: 'Incorrect example', password: 'Updated password example' }, 400);
  await other('profile/password', { currentPassword: 'Other test passphrase', password: 'Updated password example' });
  await other('state', null, 401);
  await other('login', { email: colleague.email, password: 'Updated password example' });
  assert.ok((await admin('access-audit')).some((entry) => entry.action === 'Employee deactivated'));
  await staff('logout', {});
  await staff('state', null, 401);
});


test('leave accounting skips holidays and preserves unpaid balances and approved time corrections', () => {
  const settings = { week_off: 0, monthly_leave: 1 };
  const employee = { id: 4, employment_start: '2026-11-01' };
  const holiday = { day: '2026-11-18', name: 'Studio closed' };
  const leave = (start, end, type) => ({
    employee_id: employee.id, kind: 'leave', status: 'approved', day_from: start, day_to: end, leave_type: type,
  });
  const ledger = leaveLedger([
    leave('2026-11-17', '2026-11-17', 'half'),
    leave('2026-11-18', '2026-11-19', 'casual'),
  ], employee, settings, [holiday]);
  assert.equal(ledger.days.has(holiday.day), false);
  assert.deepEqual(ledger.days.get('2026-11-19'), { units: 1, paid: 0.5, unpaid: 0.5 });
  assert.deepEqual(ledger.balance('2026-11-19'), { earned: 1, used: 1, available: 0 });
  const date = '2026-11-19';
  const hour = 3_600_000;
  const start = dayStart(date);
  const correction = { clock_in: start + 8 * hour, clock_out: start + 16 * hour };
  const records = [
    { clock_in: start + 9 * hour, clock_out: start + 11 * hour },
    { clock_in: start + 12 * hour, clock_out: start + 15 * hour },
  ];
  assert.deepEqual(timeForDay(records, date, start + dayLength, correction), {
    in: correction.clock_in, out: correction.clock_out, total: 7 * hour,
  });
});

test('sign-in parses streamed UTF-8 JSON with no global Buffer', async (t) => {
  const db = openStore(new DatabaseSync(':memory:'));
  t.after(() => db.close());
  const email = 'edge@example.invalid';
  const password = 'Example test 🔐 passphrase';
  db.prepare(`
    INSERT INTO employees (name, role, email, color, password_hash)
    VALUES ('Edge Employee', 'Photographer', ?, 'peach', ?)
  `).run(email, await hashPassword(password));

  const api = createApi(sqliteAdapter(db));
  const bytes = new TextEncoder().encode(JSON.stringify({ email, password }));
  const split = bytes.indexOf(0xF0) + 1;
  let cookie;
  async function login(chunks) {
    const req = {
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield* chunks; },
    };
    return api(req, { setHeader(_name, value) { cookie = value; } }, '/api/login');
  }

  // The hosted Edge Runtime supplies byte chunks without Node's Buffer global.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  delete globalThis.Buffer;
  try {
    const signedIn = await login([bytes.slice(0, split), bytes.slice(split)]);
    assert.equal(signedIn.ok, true);
    assert.equal(signedIn.actor.email, email);
    assert.equal(signedIn.actor.is_admin, 0);
    assert.equal('password_hash' in signedIn.actor, false);
    assert.match(cookie, /concept_session=/);
    await assert.rejects(login([new Uint8Array([0xFF])]), { status: 400 });
    await assert.rejects(login([new Uint8Array(32001)]), { status: 413 });
  } finally {
    Object.defineProperty(globalThis, 'Buffer', descriptor);
  }
});

test('calendar events use stable identifiers, UTC times, and safe UTF-8 line folding', () => {
  const site = new URL('https://studio.example.invalid/#schedule');
  const start = Date.parse('2026-11-21T10:00:00+05:30');
  const task = {
    id: 5, start_at: start, estimate: 90, priority: 1,
    title: 'చిత్రీకరణ'.repeat(10) + ', studio; take\nEND:VEVENT',
    location: 'Studio A', calendar_updated_at: start - 60_000, calendar_sequence: 2,
    additional_sites: JSON.stringify([{ name: 'Studio B', latitude: 17.39, longitude: 78.48 }]),
  };
  const calendar = formatCalendar([task], site);
  const unfolded = calendar.replace(/\r\n /g, '');
  assert.match(unfolded, /UID:concept-task-5@studio\.example\.invalid/);
  assert.match(unfolded, /DTSTART:20261121T043000Z\r\nDTEND:20261121T060000Z/);
  assert.match(unfolded, /SEQUENCE:2/);
  assert.match(unfolded, /LOCATION:Studio A \/ Studio B/);
  assert.match(unfolded, /\\, studio\\; take\\nEND:VEVENT/);
  assert.equal(calendar.split('\r\n').filter((line) => line === 'END:VEVENT').length, 1);
  assert.ok(calendar.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(calendar.endsWith('END:VCALENDAR\r\n'), true);
});
