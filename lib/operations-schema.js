export function installOperationsSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE daily_plans (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), work_day TEXT NOT NULL,
        revision INTEGER NOT NULL, previous_id INTEGER REFERENCES daily_plans(id),
        status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
        entries TEXT NOT NULL CHECK (json_type(entries) = 'array'), reason TEXT,
        created_at INTEGER NOT NULL, submitted_at INTEGER, decided_at INTEGER, decided_by INTEGER REFERENCES employees(id), review_note TEXT,
        UNIQUE(employee_id, work_day, revision)
      ) STRICT;
      CREATE UNIQUE INDEX one_open_plan ON daily_plans(employee_id, work_day) WHERE status IN ('draft', 'submitted');
      CREATE UNIQUE INDEX one_approved_plan ON daily_plans(employee_id, work_day) WHERE status = 'approved';
      ALTER TABLE tasks ADD COLUMN daily_plan_id INTEGER REFERENCES daily_plans(id);
      ALTER TABLE tasks ADD COLUMN work_state TEXT NOT NULL DEFAULT 'ready' CHECK (work_state IN ('ready', 'reschedule', 'review'));
      ALTER TABLE tasks ADD COLUMN acknowledged_at INTEGER;
      ALTER TABLE tasks ADD COLUMN completion_report TEXT;
      ALTER TABLE tasks ADD COLUMN emergency INTEGER NOT NULL DEFAULT 0 CHECK (emergency IN (0, 1));
      CREATE INDEX task_daily_plan ON tasks(daily_plan_id);
      CREATE TABLE task_changes (
        id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
        kind TEXT NOT NULL CHECK (kind IN ('extension', 'reschedule', 'reassign')),
        reason TEXT NOT NULL, proposed_start INTEGER, minutes INTEGER, proposed_employee INTEGER REFERENCES employees(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        requested_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by INTEGER REFERENCES employees(id), review_note TEXT
      ) STRICT;
      CREATE UNIQUE INDEX one_pending_task_change ON task_changes(task_id) WHERE status = 'pending';
      CREATE TABLE operation_notices (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), event_key TEXT NOT NULL,
        title TEXT NOT NULL, message TEXT NOT NULL, task_id INTEGER REFERENCES tasks(id), created_at INTEGER NOT NULL, read_at INTEGER,
        UNIQUE(employee_id, event_key)
      ) STRICT;
      CREATE INDEX operation_notice_recipient ON operation_notices(employee_id, created_at DESC);
      CREATE TABLE business_audit (
        id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES employees(id), subject TEXT NOT NULL, record_id INTEGER NOT NULL,
        action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)), occurred_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX business_audit_subject ON business_audit(subject, record_id, occurred_at DESC);
      PRAGMA user_version = 10;
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
