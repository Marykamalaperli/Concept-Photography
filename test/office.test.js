import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hashPassword, passwordMatches } from '../lib/accounts.js';
import { createMobilePush } from '../lib/mobile-push.js';
import { minimizeHistoricalDetails } from '../lib/retention.js';
import { settingsAt } from '../lib/business-settings.js';
import { endAttendanceGap, refreshAttendanceGaps } from '../lib/attendance-gaps.js';
import { openStore } from '../store.js';
import { sqliteAdapter } from '../sqlite-adapter.js';
import { createBackup, restoreBackup, verifyDatabase } from '../scripts/database-backup.js';
import { migrateOffice } from '../scripts/migration/import-office.js';
import { rehearseOfficeMigration } from '../scripts/migration/rehearse-office.js';

test('synthetic migration reconciles the imported and recovered workspace', async () => {
  const report = await rehearseOfficeMigration();
  assert.equal(report.counts.employees, 2);
  assert.equal(report.counts.payments, 2);
  assert.equal(report.accountsRequiringEnrollment, 1);
  assert.equal(report.attendanceMinutes, 60);
  assert.equal(report.cashProfitPaise, '53502');
  assert.equal(report.outstandingPaise, '64999');
  assert.equal(report.restoredAndReconciled, true);
  assert.equal(report.existingDestinationProtected, true);
});

test('legacy dry run validates relationships and financial totals before creating a separate SQLite file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'concept-import-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const password = 'Synthetic employee passphrase';
  const employeeHash = await hashPassword(password);
  const adminHash = await hashPassword('Outdated test admin passphrase');
  const snapshot = {
    format_version: 1,
    tables: {
      employees: [
        { id: 7, name: 'Studio manager', role: 'Manager', email: 'manager@example.invalid', color: 'peach', is_admin: 1, password_hash: adminHash },
        { id: 9, name: 'Studio employee', role: 'Editor', email: 'employee@example.invalid', color: 'sage', password_hash: employeeHash },
      ],
      office: [{ id: 1, name: 'Studio', latitude: 17.38, longitude: 78.48 }],
      clients: [{ id: 11, name: 'Studio client', phone: '9000000000' }],
      tasks: [{ id: 40, title: 'Studio booking', employee_id: 9, start_at: '1795712400000', estimate: 180,
        location: 'Studio', category: 'Photo shoot', client_id: 11, income_paise: '120500' }],
      task_sessions: [{ id: 6, task_id: 40, employee_id: 9, start_at: 1795712400000, end_at: 1795713000000 }],
      attendance: [{ id: 4, employee_id: 9, clock_in: 1795712400000, clock_out: 1795713000000, in_location: '{"label":"Studio"}' }],
      reminders: [], work_requests: [], holidays: [], hr_requests: [], work_logs: [], payslips: [], announcements: [], shoot_crew: [],
      payments: [{ id: 10, task_id: 40, amount_paise: 10001, paid_on: '2026-11-27' }],
      expenses: [{ id: 12, name: 'Fuel', category: 'Travel', amount_paise: 1999, spent_on: '2026-11-27' }],
      hr_settings: [{ id: 1, week_off: 0, monthly_leave: 3 }],
    },
  };
  const source = join(directory, 'legacy.json');
  const destination = join(directory, 'workspace.sqlite');
  await writeFile(source, JSON.stringify(snapshot));
  const dryRun = await migrateOffice({ source });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.accountsRequiringEnrollment, 1);
  assert.equal(dryRun.counts.attendance, 1);
  assert.deepEqual(dryRun.financialTotals, { bookedValuePaise: '120500', receivedPaise: '10001', spentPaise: '1999' });
  await migrateOffice({ source, destination });
  await assert.rejects(migrateOffice({ source, destination }), { code: 'EEXIST' });
  const db = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT password_hash FROM employees WHERE id = 7').get().password_hash, null);
    assert.ok(await passwordMatches(password, db.prepare('SELECT password_hash FROM employees WHERE id = 9').get().password_hash));
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM auth_sessions').get().total, 0);
    assert.equal(db.prepare('SELECT client_id FROM tasks WHERE id = 40').get().client_id, 11);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal((await settingsAt(sqliteAdapter(db), '2026-11-27')).monthly_leave, 3);
  } finally {
    db.close();
  }
  snapshot.tables.payments[0].task_id = 99;
  await writeFile(source, JSON.stringify(snapshot));
  await assert.rejects(migrateOffice({ source }), /broken record relationships/);
});

test('online SQLite backup restores a verified copy without replacing an existing database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'concept-backup-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'live.sqlite');
  const restored = join(directory, 'restored.sqlite');
  const db = openStore(new DatabaseSync(source));
  try {
    db.exec("INSERT INTO clients (name, phone) VALUES ('First client', '9000000000')");
    const saved = await createBackup(source, join(directory, 'backups'));
    db.exec("INSERT INTO clients (name, phone) VALUES ('Second client', '9000000001')");
    assert.deepEqual(verifyDatabase(saved), verifyDatabase(source));
    await restoreBackup(saved, restored);
    await assert.rejects(restoreBackup(saved, source), { code: 'EEXIST' });
    const recovered = new DatabaseSync(restored, { readOnly: true });
    try {
      assert.equal(recovered.prepare('SELECT COUNT(*) AS total FROM clients').get().total, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM clients').get().total, 2);
      assert.deepEqual(recovered.prepare("SELECT action FROM business_audit WHERE subject = 'database recovery' ORDER BY id")
        .all().map(({ action }) => action), ['backup verified', 'restore verified']);
    } finally {
      recovered.close();
    }
  } finally {
    db.close();
  }
});

test('configured retention minimizes old personal details while preserving attendance and audit facts', async (t) => {
  const db = openStore(new DatabaseSync(':memory:'));
  t.after(() => db.close());
  const start = Date.parse('2026-07-01T09:00:00+05:30');
  const end = start + 8 * 3_600_000;
  const now = start + 71 * 86_400_000;
  const location = JSON.stringify({ label: 'Studio', latitude: 17.38, longitude: 78.48, accuracy: 7, capturedAt: start });
  db.exec(`INSERT INTO employees (name, role, email, color) VALUES ('Studio employee','Editor','retention@example.invalid','sage');
    UPDATE hr_settings SET attendance_fix_days = 45, audit_detail_days = 60 WHERE id = 1;`);
  db.prepare('INSERT INTO attendance (employee_id,clock_in,clock_out,in_location,out_location) VALUES (1,?,?,?,?)')
    .run(start, end, location, location);
  db.prepare('INSERT INTO attendance (employee_id,clock_in,in_location) VALUES (1,?,?)').run(now - 14 * 60_000, location);
  db.prepare("INSERT INTO business_audit (actor_id,subject,record_id,action,occurred_at,details) VALUES (1,'attendance correction',1,'approved',?,?)")
    .run(start, JSON.stringify({ privateNote: 'Synthetic old detail' }));
  assert.deepEqual(await minimizeHistoricalDetails(sqliteAdapter(db), now), { fixes: 1, audits: 1 });
  const [closed, open] = db.prepare('SELECT * FROM attendance ORDER BY clock_in').all();
  assert.equal(closed.clock_in, start);
  assert.equal(closed.clock_out, end);
  assert.deepEqual(JSON.parse(closed.in_location), { label: 'Studio' });
  assert.equal(open.in_location, location);
  const event = db.prepare('SELECT * FROM business_audit ORDER BY id').get();
  assert.equal(event.actor_id, 1);
  assert.equal(event.action, 'approved');
  assert.equal(event.details, '{}');
  assert.equal(event.details_minimized_at, now);
  assert.deepEqual(await minimizeHistoricalDetails(sqliteAdapter(db), now), { fixes: 0, audits: 0 });
});

test('missed GPS checks create one review gap and leave the shift open through verification', async (t) => {
  const db = openStore(new DatabaseSync(':memory:'));
  t.after(() => db.close());
  const adapter = sqliteAdapter(db);
  const start = 1795712400000;
  db.exec("INSERT INTO employees (name, role, email, color) VALUES ('Test employee', 'Photographer', 'gps@example.invalid', 'sage')");
  db.prepare("INSERT INTO attendance (employee_id, clock_in, in_location, site, last_verified_at) VALUES (1, ?, '{}', '{}', ?)")
    .run(start, start);
  await refreshAttendanceGaps(adapter, start + 4 * 60_000);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM attendance_gaps').get().total, 0);
  await refreshAttendanceGaps(adapter, start + 5 * 60_000);
  await refreshAttendanceGaps(adapter, start + 6 * 60_000);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM attendance_gaps').get().total, 1);
  assert.equal(db.prepare('SELECT clock_out FROM attendance').get().clock_out, null);
  await adapter.transaction(async (store) => {
    await endAttendanceGap(store, 1, start + 8 * 60_000);
    await store.run('UPDATE attendance SET last_verified_at = ?', start + 8 * 60_000);
  });
  assert.equal(db.prepare('SELECT resolved_at FROM attendance_gaps').get().resolved_at, start + 8 * 60_000);
  await refreshAttendanceGaps(adapter, start + 9 * 60_000);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM attendance_gaps').get().total, 1);
  assert.equal(db.prepare('SELECT clock_out FROM attendance').get().clock_out, null);
});

test('self-hosted push scheduling claims and sends a reminder only once', async (t) => {
  const db = openStore(new DatabaseSync(':memory:'));
  t.after(() => db.close());
  const start = Date.now() + 10 * 60_000;
  db.exec(`
    INSERT INTO employees (id, name, role, email, color) VALUES (1, 'Test employee', 'Photographer', 'push@example.invalid', 'sage');
    INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth_secret)
    VALUES (1, 'https://fcm.googleapis.com/fcm/send/example', 'test-key', 'test-secret');
  `);
  db.prepare("INSERT INTO tasks (title, employee_id, start_at, estimate, location, category) VALUES ('Test shoot', 1, ?, 60, 'Studio', 'Photo shoot')")
    .run(start);
  const received = [];
  const device = createMobilePush({
    generateVAPIDKeys: () => ({ publicKey: 'test-public', privateKey: 'test-private' }),
    generateRequestDetails: (subscription, payload) => ({ endpoint: subscription.endpoint, method: 'POST', body: payload }),
  }, 'https://studio.example.invalid', async (_endpoint, request) => {
    received.push(JSON.parse(request.body));
    return new Response(null, { status: 201 });
  });
  const adapter = sqliteAdapter(db);
  await Promise.all([device.dispatch(adapter), device.dispatch(adapter)]);
  assert.equal(received.length, 1);
  assert.match(received[0].body, /^Test shoot starts at /);
  assert.ok(db.prepare('SELECT sent_at FROM push_deliveries').get().sent_at);
});

test('work update push is opt-in per device and retries without copying private details', async (t) => {
  const initial = new Date('2026-11-27T15:00:00+05:30');
  t.mock.timers.enable({ apis: ['Date'], now: initial });
  const db = openStore(new DatabaseSync(':memory:'));
  t.after(() => db.close());
  const adapter = sqliteAdapter(db);
  const opted = 'https://fcm.googleapis.com/fcm/send/opted';
  const defaultDevice = 'https://fcm.googleapis.com/fcm/send/default';
  await adapter.run("INSERT INTO employees (id, name, role, email, color) VALUES (1, 'Test employee', 'Editor', 'push@example.invalid', 'sage')");
  for (const endpoint of [opted, defaultDevice]) {
    await adapter.run('INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth_secret) VALUES (1, ?, ?, ?)', endpoint, 'test-key', 'test-secret');
  }
  await adapter.run(`
    INSERT INTO operation_notices (employee_id,event_key,title,message,created_at) VALUES
      (1,'assigned:1','Work assignment updated','Private customer and location',?),
      (1,'shift-review:2','Shift needs review','Another private record',?)
  `, Date.now(), Date.now() - 21 * 60_000);
  const received = [];
  const createDevice = () => createMobilePush({
    generateVAPIDKeys: () => ({ publicKey: 'test-public', privateKey: 'test-private' }),
    generateRequestDetails: (subscription, payload) => ({ endpoint: subscription.endpoint, method: 'POST', body: payload }),
  }, 'https://studio.example.invalid', async (endpoint, request) => {
    received.push({ endpoint, payload: JSON.parse(request.body) });
    return new Response(null, { status: received.length === 1 ? 503 : 201 });
  });
  const first = createDevice();
  assert.deepEqual(await first.status(adapter, 1, opted), { enabled: true, updatesEnabled: false });
  assert.equal((await first.dispatch(adapter)).processed, 0);
  await assert.rejects(first.setUpdates(adapter, 3, { endpoint: opted, enabled: true }), { status: 409 });
  assert.deepEqual(await first.setUpdates(adapter, 1, { endpoint: opted, enabled: true }), { enabled: true, updatesEnabled: true });
  await Promise.all([first.dispatch(adapter), first.dispatch(adapter)]);
  assert.equal(received.length, 1);
  assert.equal((await adapter.get('SELECT attempts FROM operation_push_deliveries')).attempts, 1);
  t.mock.timers.setTime(initial.valueOf() + 2 * 60_000);
  const restarted = createDevice();
  await restarted.dispatch(adapter);
  await restarted.dispatch(adapter);
  assert.equal(received.length, 2);
  assert.deepEqual(received[0], received[1]);
  assert.equal(received[0].endpoint, opted);
  assert.equal(received[0].payload.body, 'Work assignment updated. Open the workspace for details.');
  assert.ok((await adapter.get('SELECT sent_at FROM operation_push_deliveries')).sent_at);
});
