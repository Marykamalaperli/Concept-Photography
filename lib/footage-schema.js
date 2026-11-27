export function installFootageSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE hr_settings ADD COLUMN storage_manager_id INTEGER REFERENCES employees(id);
      CREATE TABLE footage_checks (
        id INTEGER PRIMARY KEY, shoot_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id),
        task_id INTEGER UNIQUE REFERENCES tasks(id), assigned_to INTEGER REFERENCES employees(id),
        status TEXT NOT NULL DEFAULT 'unassigned' CHECK(status IN ('unassigned','assigned','submitted','incident','returned','approved')),
        transferred INTEGER NOT NULL DEFAULT 0 CHECK(transferred IN (0,1)),
        stored INTEGER NOT NULL DEFAULT 0 CHECK(stored IN (0,1)),
        drive TEXT, folder TEXT, backup TEXT, incident TEXT CHECK(incident IN ('missing','corrupted')),
        note TEXT, screenshot_id TEXT REFERENCES private_files(id),
        created_at INTEGER NOT NULL, submitted_at INTEGER, reviewed_at INTEGER, reviewed_by INTEGER REFERENCES employees(id),
        review_note TEXT
      ) STRICT;
      CREATE INDEX footage_assignee ON footage_checks(assigned_to, status);
      PRAGMA user_version = 14;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
