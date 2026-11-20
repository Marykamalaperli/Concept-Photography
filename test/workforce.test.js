import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, refreshReminders } from '../store.js';

test('a scheduled task produces one reminder in the 30-minute window', () => {
  const db = openStore(new DatabaseSync(':memory:'), { seed: false });
  const start = Date.parse('2026-11-20T10:00:00Z');
  const minute = 60_000;
  db.exec("INSERT INTO employees (id, name, role, email, color) VALUES (1, 'Jamie Chen', 'Photographer', 'jamie@example.com', 'peach')");
  const insertTask = db.prepare("INSERT INTO tasks (id, title, employee_id, start_at, estimate, location, category, completed_at) VALUES (?, ?, 1, ?, 90, 'Studio A', 'Photo shoot', ?)");
  insertTask.run(1, 'Upcoming shoot', start, null);
  insertTask.run(2, 'Early delivery', start, start - 31 * minute);
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

test('team, schedule, reminders, timers and location-stamped attendance survive restart', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'concept-workforce-'));
  const database = join(directory, 'workforce.sqlite');
  let server;
  t.after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    await rm(directory, { recursive: true, force: true });
  });

  async function startServer() {
    server = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATABASE_PATH: database, SEED_DEMO: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const base = await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`Server exited during startup: ${code}`)));
      server.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    return async (path, body, expected = 200) => {
      const response = await fetch(`${base}/api/${path}`, body ? {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      } : undefined);
      const payload = await response.json();
      assert.equal(response.status, expected, JSON.stringify(payload));
      return payload;
    };
  }

  let api = await startServer();
  const person = await api('employees', { name: 'Jamie Chen', role: 'Photographer', email: 'jamie@example.com' });
  const employeeId = person.id;
  const task = await api('tasks', {
    employeeId, title: 'Retouch portraits', category: 'Editing', location: 'Studio A',
    estimate: 90, startAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  });
  const taskAction = (action, expected) => api('task-action', { employeeId, taskId: task.id, action }, expected);
  const location = { latitude: 17.385, longitude: 78.4867, accuracy: 8 };
  const at = (coordinates) => ({ ...coordinates, capturedAt: Date.now() });
  const clock = (id, action, coordinates, options = {}, expected = 200) => api('attendance',
    { employeeId: id, action, location: coordinates && at(coordinates), ...options }, expected);
  const other = await api('employees', { name: 'Sam Rivera', role: 'Photographer', email: 'sam@example.com' });
  await api('office', { actorId: other.id, name: 'Studio A', ...location }, 403);
  await api('office', { actorId: employeeId, name: 'Studio A', ...location });
  await clock(employeeId, 'in', null, {}, 400);
  await clock(employeeId, 'in', { ...location, accuracy: 80 }, {}, 422);
  await clock(employeeId, 'in', { ...location, latitude: 17.387 }, {}, 422);
  await clock(employeeId, 'in', location, { location: { ...location, capturedAt: Date.now() - 60_000 } }, 400);
  const shift = await clock(employeeId, 'in', location);
  await clock(employeeId, 'in', location, {}, 409);
  await taskAction('start');
  await taskAction('start', 409);
  await taskAction('pause');
  await taskAction('start');
  await taskAction('complete');
  const outLocation = { ...location, latitude: 17.3852 };
  const beyondOffice = { ...location, latitude: 17.3862 };
  await clock(employeeId, 'out', beyondOffice, { shiftId: shift.id }, 422);
  await clock(employeeId, 'out', outLocation, { shiftId: shift.id });
  assert.equal(await clock(employeeId, 'observe', location, { shiftId: shift.id }), null);
  await api('reminders/read', { employeeId });

  const shootCoordinates = { latitude: 17.388, longitude: 78.4867, accuracy: 8 };
  const shootInfo = {
    actorId: employeeId, employeeId: other.id, title: 'Outdoor shoot', category: 'Photo shoot',
    location: 'Courtyard', estimate: 60, startAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  await api('tasks', shootInfo, 400);
  await api('tasks', { ...shootInfo, actorId: other.id, ...shootCoordinates }, 403);
  const shoot = await api('tasks', { ...shootInfo, ...shootCoordinates });
  await clock(employeeId, 'in', shootCoordinates, { taskId: shoot.id }, 403);
  await clock(other.id, 'in', location, { taskId: shoot.id }, 422);
  await clock(other.id, 'in', shootCoordinates, {}, 422);
  await api('task-action', { employeeId: other.id, taskId: shoot.id, action: 'start' }, 409);
  const shootShift = await clock(other.id, 'in', shootCoordinates, { taskId: shoot.id });
  assert.equal(JSON.parse(shootShift.site).taskId, shoot.id);
  assert.ok((await api('state')).sessions.some((entry) => entry.task_id === shoot.id && entry.end_at === null));
  const nearEdge = { ...shootCoordinates, latitude: 17.38892 };
  assert.equal(await clock(other.id, 'observe', nearEdge, { shiftId: shootShift.id }), null);
  const exit = await clock(other.id, 'observe', location, { shiftId: shootShift.id });
  assert.equal(exit.out_reason, 'geofence');
  assert.equal(exit.resume_pending, 1);
  assert.ok((await api('state')).sessions.filter((entry) => entry.task_id === shoot.id).every((entry) => entry.end_at !== null));
  assert.equal(await clock(other.id, 'observe', shootCoordinates, { shiftId: shootShift.id + 1 }), null);
  const returnShift = await clock(other.id, 'observe', shootCoordinates, { shiftId: shootShift.id });
  assert.equal(returnShift.in_reason, 'geofence');
  assert.equal(await clock(other.id, 'observe', shootCoordinates, { shiftId: shootShift.id }), null);
  await clock(other.id, 'observe', location, { shiftId: returnShift.id });
  await clock(other.id, 'cancel-return', null, { shiftId: returnShift.id });
  assert.equal(await clock(other.id, 'observe', shootCoordinates, { shiftId: returnShift.id }), null);

  server.kill();
  await once(server, 'exit');
  api = await startServer();
  const state = await api('state');
  assert.equal(state.employees[0].name, 'Jamie Chen');
  const original = state.tasks.find((entry) => entry.id === task.id);
  assert.equal(original.estimate, 90);
  assert.ok(original.completed_at);
  assert.equal(state.sessions.length, 4);
  assert.ok(state.sessions.every((session) => session.end_at >= session.start_at));
  const studioShift = state.attendance.find((entry) => entry.id === shift.id);
  assert.ok(studioShift.clock_out >= studioShift.clock_in);
  assert.deepEqual(JSON.parse(studioShift.in_location), location);
  assert.deepEqual(JSON.parse(studioShift.out_location), outLocation);
  assert.equal(state.office.name, 'Studio A');
  assert.equal(state.reminders.length, 2);
  assert.ok(state.reminders.find((notice) => notice.task_id === task.id).read_at);
  assert.deepEqual(state.attendance.filter((entry) => entry.employee_id === other.id).map((entry) => entry.resume_pending), [0, 0]);
});
