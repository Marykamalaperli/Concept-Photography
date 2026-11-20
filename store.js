const minute = 60_000;

export function openStore(db, { seed = process.env.SEED_DEMO !== '0', now = Date.now() } = {}) {
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
  if (!db.prepare('PRAGMA user_version').get().user_version) {
    db.exec('BEGIN');
    try {
      if (seed) seedDemo(db, now);
      db.exec('PRAGMA user_version = 1; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
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
      if (seed && db.prepare("SELECT id FROM employees WHERE email = 'alex.morgan@example.com' AND is_admin = 1").get()) {
        // Demo coordinates only. Other workspaces need their office configured by the manager.
        db.exec(`
          INSERT INTO office VALUES (1, 'Main studio · Sample', 17.385, 78.4867);
          UPDATE tasks SET site_latitude = 17.3868, site_longitude = 78.4867
          WHERE category = 'Photo shoot' AND title IN ('Studio product shoot', 'Portrait session');
        `);
      }
      db.exec('PRAGMA user_version = 2; COMMIT;');
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
    WHERE completed_at IS NULL AND start_at BETWEEN ? AND ?
  `).run(now, now, now + 30 * minute);
}

function seedDemo(db, now) {
  const addEmployee = db.prepare('INSERT INTO employees (name, role, email, color) VALUES (?, ?, ?, ?)');
  for (const [name, role, color] of [
    ['Alex Morgan', 'Studio Manager', 'peach'],
    ['Jamie Chen', 'Lead Photographer', 'lavender'],
    ['Priya Sharma', 'Photo Editor', 'sage'],
    ['Jordan Lee', 'Studio Assistant', 'sand'],
    ['Taylor Brooks', 'Photographer', 'rose'],
  ]) {
    addEmployee.run(name, role, name.toLowerCase().replace(' ', '.') + '@example.com', color);
  }

  // Anchor sample dates to the studio’s calendar in India.
  const studioDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now));
  const day = Date.parse(studioDate + 'T00:00:00+05:30');
  const addTask = db.prepare(`
    INSERT INTO tasks (title, employee_id, start_at, estimate, location, category, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  addTask.run('Studio product shoot', 2, day + 540 * minute, 120, 'Studio A', 'Photo shoot', null);
  addTask.run('Editorial retouching', 3, day + 690 * minute, 90, 'Editing suite', 'Editing', null);
  addTask.run('Client moodboard review', 1, day + 840 * minute, 45, 'Meeting room', 'Planning', null);
  addTask.run('Equipment prep', 4, day + 960 * minute, 60, 'Studio B', 'Studio', null);
  addTask.run('Portrait session', 5, day + 2040 * minute, 90, 'Studio A', 'Photo shoot', null);
  addTask.run('Deliver campaign selects', 1, day - 600 * minute, 75, 'Editing suite', 'Editing', day - 525 * minute);
  db.prepare('INSERT INTO task_sessions (task_id, employee_id, start_at, end_at) VALUES (6, 1, ?, ?)')
    .run(day - 600 * minute, day - 532 * minute);

  const addAttendance = db.prepare('INSERT INTO attendance (employee_id, clock_in, clock_out, in_location, out_location) VALUES (?, ?, ?, ?, ?)');
  const studio = JSON.stringify({ label: 'Main studio · Sample' });
  addAttendance.run(2, now - 145 * minute, null, studio, null);
  addAttendance.run(3, now - 95 * minute, null, studio, null);
  addAttendance.run(4, now - 50 * minute, null, studio, null);
  addAttendance.run(1, now - 1440 * minute, now - 960 * minute, studio, studio);
}
