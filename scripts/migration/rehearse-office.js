import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, passwordMatches } from '../../lib/accounts.js';
import { createBackup, restoreBackup, verifyDatabase } from '../database-backup.js';
import { migrateOffice } from './import-office.js';

function legacySnapshot(hash) {
  const start = Date.parse('2026-11-27T09:00:00+05:30');
  return { format_version: 1, tables: {
    employees: [
      { id: 7, name: 'Rehearsal manager', role: 'Manager', email: 'manager@example.invalid', color: 'peach', is_admin: 1, password_hash: hash },
      { id: 9, name: 'Rehearsal photographer', role: 'Photographer', email: 'crew@example.invalid', color: 'sage', password_hash: hash },
    ],
    office: [{ id: 1, name: 'Rehearsal office', latitude: 17.38, longitude: 78.48 }],
    clients: [{ id: 11, name: 'Rehearsal client', phone: '9000000000' }],
    tasks: [{ id: 40, title: 'Rehearsal booking', employee_id: 9, start_at: String(start), estimate: 180,
      location: 'Rehearsal location', category: 'Photo shoot', client_id: 11, income_paise: '120500' }],
    task_sessions: [{ id: 6, task_id: 40, employee_id: 9, start_at: start, end_at: start + 10 * 60_000 }],
    attendance: [{ id: 4, employee_id: 9, clock_in: start, clock_out: start + 60 * 60_000,
      in_location: '{"label":"Rehearsal office"}' }],
    reminders: [], work_requests: [], holidays: [], hr_requests: [], work_logs: [], payslips: [], announcements: [], shoot_crew: [],
    payments: [
      { id: 10, task_id: 40, amount_paise: 10_001, paid_on: '2026-11-26' },
      { id: 11, task_id: 40, amount_paise: 45_500, paid_on: '2026-11-27' },
    ],
    expenses: [{ id: 12, name: 'Rehearsal expense', category: 'Travel', amount_paise: 1_999, spent_on: '2026-11-27' }],
    hr_settings: [{ id: 1, week_off: 0, monthly_leave: 3 }],
  } };
}

async function reconcile(path, password) {
  const { schema } = verifyDatabase(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const booking = db.prepare('SELECT client_id, employee_id, CAST(income_paise AS TEXT) AS booked FROM tasks WHERE id = 40').get();
    assert.equal(booking.client_id, 11);
    assert.equal(booking.employee_id, 9);
    const amount = db.prepare(`SELECT
      CAST((SELECT SUM(amount_paise) FROM payments WHERE task_id = 40) AS TEXT) AS received,
      CAST((SELECT SUM(amount_paise) FROM expenses) AS TEXT) AS spent`).get();
    assert.equal(booking.booked, '120500');
    assert.equal(amount.received, '55501');
    assert.equal(amount.spent, '1999');
    const shift = db.prepare('SELECT employee_id, clock_out - clock_in AS duration FROM attendance WHERE id = 4').get();
    assert.equal(shift.employee_id, 9);
    assert.equal(shift.duration, 60 * 60_000);
    assert.equal(db.prepare('SELECT password_hash FROM employees WHERE id = 7').get().password_hash, null);
    assert.ok(await passwordMatches(password, db.prepare('SELECT password_hash FROM employees WHERE id = 9').get().password_hash));
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM auth_sessions').get().total, 0);
    return { schema, attendanceMinutes: 60, cashProfitPaise: String(BigInt(amount.received) - BigInt(amount.spent)),
      outstandingPaise: String(BigInt(booking.booked) - BigInt(amount.received)) };
  } finally { db.close(); }
}

export async function rehearseOfficeMigration() {
  const directory = await mkdtemp(join(tmpdir(), 'concept-migration-rehearsal-'));
  try {
    const password = randomBytes(24).toString('base64url');
    const source = join(directory, 'synthetic-export.json');
    const destination = join(directory, 'imported.sqlite');
    const restored = join(directory, 'restored.sqlite');
    const snapshot = legacySnapshot(await hashPassword(password));
    await writeFile(source, JSON.stringify(snapshot), { mode: 0o600 });
    const { mode, ...dryRun } = await migrateOffice({ source });
    const { mode: importMode, ...imported } = await migrateOffice({ source, destination });
    assert.equal(mode, 'dry-run');
    assert.equal(importMode, 'import');
    assert.deepEqual(imported, dryRun);
    assert.equal(imported.accountsRequiringEnrollment, 1);
    assert.deepEqual(imported.counts, Object.fromEntries(Object.entries(snapshot.tables).map(([table, rows]) => [table, rows.length])));
    await assert.rejects(migrateOffice({ source, destination }), { code: 'EEXIST' });
    const before = await reconcile(destination, password);
    const backup = await createBackup(destination, join(directory, 'backups'));
    await restoreBackup(backup, restored);
    assert.deepEqual(await reconcile(restored, password), before);
    return { ...imported, ...before, restoredAndReconciled: true, existingDestinationProtected: true };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await rehearseOfficeMigration(), null, 2));
  } catch (error) {
    console.error('Synthetic migration rehearsal failed.', error.message);
    process.exitCode = 1;
  }
}
