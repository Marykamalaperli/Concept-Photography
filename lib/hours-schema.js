export function installHoursSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE hr_settings ADD COLUMN lunch_start TEXT;
      ALTER TABLE hr_settings ADD COLUMN lunch_minutes INTEGER NOT NULL DEFAULT 45 CHECK (lunch_minutes BETWEEN 5 AND 180);
      ALTER TABLE hr_settings ADD COLUMN personal_break_minutes INTEGER NOT NULL DEFAULT 15 CHECK (personal_break_minutes BETWEEN 5 AND 180);
      CREATE TABLE work_periods (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
        kind TEXT NOT NULL CHECK (kind IN ('lunch', 'personal', 'travel')),
        start_at INTEGER NOT NULL, end_at INTEGER CHECK(end_at >= start_at),
        task_id INTEGER REFERENCES tasks(id), note TEXT,
        CHECK ((kind = 'travel') = (task_id IS NOT NULL))
      ) STRICT;
      CREATE UNIQUE INDEX one_open_work_period ON work_periods(employee_id) WHERE end_at IS NULL;
      CREATE INDEX work_period_by_employee ON work_periods(employee_id, start_at);
      CREATE TABLE shift_reviews (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
        attendance_id INTEGER NOT NULL UNIQUE REFERENCES attendance(id), work_day TEXT NOT NULL,
        ended_at INTEGER NOT NULL, required_ms INTEGER NOT NULL, recorded_ms INTEGER NOT NULL,
        next_plan_day TEXT, location_unverified INTEGER NOT NULL CHECK(location_unverified IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'follow-up')),
        review_note TEXT, reviewed_by INTEGER REFERENCES employees(id), reviewed_at INTEGER
      ) STRICT;
      CREATE INDEX shift_reviews_employee ON shift_reviews(employee_id, work_day);
      CREATE TABLE worksheet_remarks (
        employee_id INTEGER NOT NULL REFERENCES employees(id), work_day TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('employee', 'admin')), remark TEXT NOT NULL,
        written_by INTEGER NOT NULL REFERENCES employees(id), updated_at INTEGER NOT NULL,
        PRIMARY KEY(employee_id, work_day, scope)
      ) STRICT;
      PRAGMA user_version = 11;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
