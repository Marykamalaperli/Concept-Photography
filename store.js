const minute = 60_000;

export function openStore(db, { now = Date.now() } = {}) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE, color TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id),
      start_at INTEGER NOT NULL, estimate INTEGER NOT NULL, location TEXT NOT NULL,
      category TEXT NOT NULL, completed_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS task_sessions (
      id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id), start_at INTEGER NOT NULL, end_at INTEGER
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_task ON task_sessions(employee_id) WHERE end_at IS NULL;
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
      clock_in INTEGER NOT NULL, clock_out INTEGER, in_location TEXT NOT NULL, out_location TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_shift ON attendance(employee_id) WHERE clock_out IS NULL;
    CREATE TABLE IF NOT EXISTS reminders (
      task_id INTEGER PRIMARY KEY REFERENCES tasks(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
      sent_at INTEGER NOT NULL, read_at INTEGER
    ) STRICT;
  `);
  if (db.prepare('PRAGMA user_version').get().user_version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE employees ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
        UPDATE employees SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM employees);
        ALTER TABLE tasks ADD COLUMN site_latitude REAL;
        ALTER TABLE tasks ADD COLUMN site_longitude REAL;
        ALTER TABLE attendance ADD COLUMN site TEXT;
        ALTER TABLE attendance ADD COLUMN in_reason TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE attendance ADD COLUMN out_reason TEXT;
        ALTER TABLE attendance ADD COLUMN resume_pending INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE office (
          id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL,
          latitude REAL NOT NULL, longitude REAL NOT NULL
        ) STRICT;
      `);
      db.exec('PRAGMA user_version = 2; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE employees ADD COLUMN phone TEXT;
        ALTER TABLE employees ADD COLUMN password_hash TEXT;
        ALTER TABLE employees ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        UPDATE employees SET is_admin = 0;
        UPDATE employees SET archived = 1
          WHERE (id, email, role, color) IN (
            (1, 'alex.morgan@example.com', 'Studio Manager', 'peach'),
            (2, 'jamie.chen@example.com', 'Lead Photographer', 'lavender'),
            (3, 'priya.sharma@example.com', 'Photo Editor', 'sage'),
            (4, 'jordan.lee@example.com', 'Studio Assistant', 'sand'),
            (5, 'taylor.brooks@example.com', 'Photographer', 'rose')
          );
        DELETE FROM office WHERE name = 'Main studio · Sample' AND latitude = 17.385 AND longitude = 78.4867;
        ALTER TABLE office ADD COLUMN maps_url TEXT;
        CREATE TABLE auth_sessions (
          token_hash TEXT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
          expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE clients (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
          email TEXT, notes TEXT
        ) STRICT;
        ALTER TABLE tasks ADD COLUMN client_id INTEGER REFERENCES clients(id);
        ALTER TABLE tasks ADD COLUMN maps_url TEXT;
        ALTER TABLE tasks ADD COLUMN income_paise INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tasks ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE work_requests (
          id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
          employee_id INTEGER NOT NULL REFERENCES employees(id), note TEXT, requested_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
          decided_at INTEGER, UNIQUE (task_id, employee_id)
        ) STRICT;
        CREATE TABLE payments (
          id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
          amount_paise INTEGER NOT NULL CHECK (amount_paise > 0), paid_on TEXT NOT NULL, note TEXT
        ) STRICT;
        CREATE TABLE expenses (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
          amount_paise INTEGER NOT NULL CHECK (amount_paise > 0), spent_on TEXT NOT NULL, note TEXT
        ) STRICT;
        PRAGMA user_version = 3;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  refreshReminders(db, now);
  return db;
}

export function refreshReminders(db, now = Date.now()) {
  db.prepare(`
    INSERT OR IGNORE INTO reminders (task_id, employee_id, sent_at)
    SELECT id, employee_id, ? FROM tasks
    WHERE completed_at IS NULL AND is_open = 0 AND start_at BETWEEN ? AND ?
  `).run(now, now, now + 30 * minute);
}
