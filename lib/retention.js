import { dayLength } from './hr-policy.js';
import { recordBusinessAudit } from './studio-notices.js';

export function installRetentionPolicies(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE hr_settings ADD COLUMN removed_file_days INTEGER CHECK(removed_file_days BETWEEN 7 AND 3650);
      ALTER TABLE hr_settings ADD COLUMN backup_days INTEGER CHECK(backup_days BETWEEN 1 AND 3650);
      ALTER TABLE hr_settings ADD COLUMN attendance_fix_days INTEGER CHECK(attendance_fix_days BETWEEN 30 AND 3650);
      ALTER TABLE hr_settings ADD COLUMN audit_detail_days INTEGER CHECK(audit_detail_days BETWEEN 30 AND 3650);
      ALTER TABLE attendance ADD COLUMN fixes_minimized_at INTEGER;
      ALTER TABLE business_audit ADD COLUMN details_minimized_at INTEGER;
      CREATE INDEX closed_attendance_fix_age ON attendance(clock_out) WHERE fixes_minimized_at IS NULL AND clock_out IS NOT NULL;
      CREATE INDEX business_audit_detail_age ON business_audit(occurred_at) WHERE details_minimized_at IS NULL;
      CREATE INDEX task_session_employee_time ON task_sessions(employee_id, start_at);
      CREATE INDEX task_session_task_employee ON task_sessions(task_id, employee_id);
      PRAGMA user_version = 27;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function minimizeHistoricalDetails(db, now = Date.now()) {
  return db.transaction(async (store) => {
    const policy = await store.get('SELECT attendance_fix_days, audit_detail_days FROM hr_settings WHERE id = 1');
    let fixes = 0;
    let audits = 0;
    if (policy.attendance_fix_days) {
      fixes = (await store.run(`UPDATE attendance SET
        in_location = CASE WHEN json_valid(in_location) THEN json_remove(in_location, '$.latitude', '$.longitude', '$.accuracy', '$.capturedAt') ELSE in_location END,
        out_location = CASE WHEN json_valid(out_location) THEN json_remove(out_location, '$.latitude', '$.longitude', '$.accuracy', '$.capturedAt') ELSE out_location END,
        fixes_minimized_at = ?
        WHERE id IN (SELECT id FROM attendance WHERE fixes_minimized_at IS NULL AND clock_out IS NOT NULL AND clock_out < ? AND resume_pending = 0
          ORDER BY clock_out LIMIT 1000)`, now, now - policy.attendance_fix_days * dayLength)).changes;
    }
    if (policy.audit_detail_days) {
      audits = (await store.run(`UPDATE business_audit SET details = '{}', details_minimized_at = ?
        WHERE id IN (SELECT id FROM business_audit WHERE details_minimized_at IS NULL AND occurred_at < ? ORDER BY occurred_at LIMIT 1000)`,
        now, now - policy.audit_detail_days * dayLength)).changes;
    }
    if (fixes || audits) await recordBusinessAudit(store, null, 'retention', 1, 'historical details minimized', now, { fixes, audits });
    return { fixes, audits };
  });
}
