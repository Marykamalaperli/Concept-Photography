export function installGeofenceSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE office ADD COLUMN address TEXT;
      ALTER TABLE office ADD COLUMN additional_sites TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(additional_sites) AND json_type(additional_sites) = 'array');
      ALTER TABLE hr_settings ADD COLUMN office_radius_m INTEGER NOT NULL DEFAULT 100 CHECK (office_radius_m BETWEEN 50 AND 100);
      ALTER TABLE hr_settings ADD COLUMN shoot_radius_m INTEGER NOT NULL DEFAULT 100 CHECK (shoot_radius_m BETWEEN 50 AND 100);
      ALTER TABLE hr_settings ADD COLUMN max_accuracy_m INTEGER NOT NULL DEFAULT 50 CHECK (max_accuracy_m BETWEEN 5 AND 100);
      CREATE TABLE attendance_boundary (
        employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
        attendance_id INTEGER NOT NULL REFERENCES attendance(id),
        observed_at INTEGER NOT NULL, captured_at INTEGER NOT NULL
      ) STRICT;
      PRAGMA user_version = 12;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
