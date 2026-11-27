import { studioDay } from './hr-policy.js';

const fields = [
  'work_start', 'work_end', 'week_off', 'monthly_leave', 'required_minutes',
  'lunch_start', 'lunch_minutes', 'personal_break_minutes', 'personal_break_paid',
  'travel_paid', 'overtime_grace_minutes', 'task_reminder_minutes', 'plan_deadline',
];
const baseline = '1900-01-01';
const snapshot = (row) => JSON.stringify(Object.fromEntries(fields.map((key) => [key, row[key]])));

export function installBusinessSettings(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE hr_settings ADD COLUMN personal_break_paid INTEGER NOT NULL DEFAULT 0 CHECK(personal_break_paid IN (0,1));
      ALTER TABLE hr_settings ADD COLUMN travel_paid INTEGER NOT NULL DEFAULT 1 CHECK(travel_paid IN (0,1));
      ALTER TABLE hr_settings ADD COLUMN overtime_grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_grace_minutes BETWEEN 0 AND 120);
      ALTER TABLE hr_settings ADD COLUMN task_reminder_minutes INTEGER NOT NULL DEFAULT 20 CHECK(task_reminder_minutes BETWEEN 0 AND 120);
      ALTER TABLE hr_settings ADD COLUMN plan_deadline TEXT NOT NULL DEFAULT '18:00';
      ALTER TABLE hr_settings ADD COLUMN boundary_samples INTEGER NOT NULL DEFAULT 2 CHECK(boundary_samples BETWEEN 2 AND 4);
      ALTER TABLE hr_settings ADD COLUMN boundary_delay_ms INTEGER NOT NULL DEFAULT 1500 CHECK(boundary_delay_ms BETWEEN 1000 AND 5000);
      ALTER TABLE hr_settings ADD COLUMN attachment_required INTEGER NOT NULL DEFAULT 0 CHECK(attachment_required IN (0,1));
      ALTER TABLE attendance_boundary ADD COLUMN samples INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE shift_reviews ADD COLUMN policy_effective_from TEXT;
      ALTER TABLE tasks ADD COLUMN evidence_required INTEGER NOT NULL DEFAULT 0 CHECK(evidence_required IN (0,1));
      CREATE TABLE attendance_policies (
        effective_from TEXT PRIMARY KEY, settings TEXT NOT NULL CHECK(json_valid(settings)),
        changed_by INTEGER REFERENCES employees(id), changed_at INTEGER
      ) STRICT;
      CREATE TRIGGER assign_task_evidence_policy AFTER INSERT ON tasks WHEN NEW.category != 'Photo shoot'
      BEGIN
        UPDATE tasks SET evidence_required = (SELECT attachment_required FROM hr_settings WHERE id = 1) WHERE id = NEW.id;
      END;
      UPDATE tasks SET acknowledged_at = (SELECT MIN(start_at) FROM task_sessions s WHERE s.task_id = tasks.id)
      WHERE category != 'Photo shoot' AND acknowledged_at IS NULL AND EXISTS (SELECT 1 FROM task_sessions s WHERE s.task_id = tasks.id);
    `);
    db.prepare('INSERT INTO attendance_policies(effective_from, settings) VALUES (?, ?)').run(baseline,
      snapshot(db.prepare('SELECT * FROM hr_settings WHERE id = 1').get()));
    db.exec('PRAGMA user_version = 25; COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function settingsAt(store, day = studioDay(Date.now())) {
  const [runtime, policy] = await Promise.all([
    store.get('SELECT * FROM hr_settings WHERE id = 1'),
    store.get('SELECT effective_from, settings FROM attendance_policies WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1', day),
  ]);
  return policy ? { ...runtime, ...JSON.parse(policy.settings), effective_from: policy.effective_from } : runtime;
}

export function savePolicy(store, { effectiveFrom, now, actor, settings }) {
  return store.run(`
    INSERT INTO attendance_policies(effective_from, settings, changed_by, changed_at) VALUES (?,?,?,?)
    ON CONFLICT(effective_from) DO UPDATE SET settings = excluded.settings, changed_by = excluded.changed_by, changed_at = excluded.changed_at
  `, effectiveFrom, snapshot(settings), actor.id, now);
}

export async function policyChanges(store, through) {
  return (await store.all('SELECT effective_from, settings FROM attendance_policies WHERE effective_from <= ? ORDER BY effective_from DESC', through))
    .map((row) => ({ ...JSON.parse(row.settings), effective_from: row.effective_from }));
}
