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
  db.exec("INSERT INTO employees VALUES (1, 'Jamie Chen', 'Photographer', 'jamie@example.com', 'peach')");
  const insertTask = db.prepare("INSERT INTO tasks VALUES (?, ?, 1, ?, 90, 'Studio A', 'Photo shoot', ?)");
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
    employeeId, title: 'Portrait session', category: 'Photo shoot', location: 'Studio A',
    estimate: 90, startAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  });
  const taskAction = (action, expected) => api('task-action', { employeeId, taskId: task.id, action }, expected);
  const location = { latitude: 17.385, longitude: 78.4867, accuracy: 8 };
  await api('attendance', { employeeId, action: 'in' }, 400);
  const shift = await api('attendance', { employeeId, action: 'in', location });
  await api('attendance', { employeeId, action: 'in', location }, 409);
  await taskAction('start');
  await taskAction('start', 409);
  await taskAction('pause');
  await taskAction('start');
  await taskAction('complete');
  const outLocation = { ...location, latitude: 17.386 };
  await api('attendance', { employeeId, action: 'out', location: outLocation });
  await api('reminders/read', { employeeId });

  server.kill();
  await once(server, 'exit');
  api = await startServer();
  const state = await api('state');
  assert.equal(state.employees[0].name, 'Jamie Chen');
  assert.equal(state.tasks[0].estimate, 90);
  assert.ok(state.tasks[0].completed_at);
  assert.equal(state.sessions.length, 2);
  assert.ok(state.sessions.every((session) => session.end_at >= session.start_at));
  assert.equal(state.attendance[0].id, shift.id);
  assert.ok(state.attendance[0].clock_out >= state.attendance[0].clock_in);
  assert.deepEqual(JSON.parse(state.attendance[0].in_location), location);
  assert.deepEqual(JSON.parse(state.attendance[0].out_location), outLocation);
  assert.equal(state.reminders.length, 1);
  assert.ok(state.reminders[0].read_at);
});
