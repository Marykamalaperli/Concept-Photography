export function installLocalFilesSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE private_files (
        id TEXT PRIMARY KEY CHECK(length(id) = 36), kind TEXT NOT NULL CHECK(kind IN ('task', 'client', 'expense', 'profile')),
        record_id INTEGER NOT NULL, uploaded_by INTEGER NOT NULL REFERENCES employees(id),
        name TEXT NOT NULL, media_type TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length > 0),
        sha256 TEXT NOT NULL CHECK(length(sha256) = 64), created_at INTEGER NOT NULL,
        removed_at INTEGER, removed_by INTEGER REFERENCES employees(id), purged_at INTEGER
      ) STRICT;
      CREATE INDEX private_files_record ON private_files(kind, record_id, created_at DESC);
      CREATE INDEX private_files_retention ON private_files(removed_at) WHERE removed_at IS NOT NULL AND purged_at IS NULL;
      ALTER TABLE tasks ADD COLUMN completion_file_id TEXT REFERENCES private_files(id);
      PRAGMA user_version = 13;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
