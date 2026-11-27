import { installBusinessSettings } from './lib/business-settings.js';
import { installAuditHistory } from './lib/audit-history.js';
import { installProfilePhotos } from './lib/profile-photos.js';
import { installScopedAccess } from './lib/scoped-access.js';
import { installOperationPushSchema } from './lib/operation-push.js';
import { installOfflineAttendanceSchema, installOfflineKeys } from './lib/offline-attendance.js';
import { installDelegationSchema } from './lib/delegation.js';
import { installProjectSchema } from './lib/projects.js';
import { installOperationsSchema } from './lib/operations-schema.js';
import { installRevenueSchema } from './lib/revenue.js';
import { installFootageSchema } from './lib/footage-schema.js';
import { installLocalFilesSchema } from './lib/local-files-schema.js';
import { installGeofenceSchema } from './lib/geofence-schema.js';
import { installHoursSchema } from './lib/hours-schema.js';

export function openStore(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
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
  if (db.prepare('PRAGMA user_version').get().user_version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        alter table employees add column employment_start text;
        alter table tasks add column shoot_status text not null default 'booked' check (shoot_status in ('booked', 'postponed', 'cancelled'));
        alter table tasks add column blocked_reason text;

        create table hr_settings (
          id integer primary key check (id = 1),
          work_start text,
          work_end text,
          week_off integer not null default 0 check (week_off between 0 and 6),
          monthly_leave integer not null default 2 check (monthly_leave between 0 and 31)
        ) STRICT;
        insert into hr_settings (id) values (1);

        create table holidays (
          day text primary key, name text not null
        ) STRICT;

        create table hr_requests (
          id INTEGER PRIMARY KEY,
          employee_id integer not null references employees(id),
          kind text not null check (kind in ('leave', 'time')),
          day_from text not null, day_to text not null,
          leave_type text check (leave_type in ('casual', 'half', 'unpaid')),
          clock_in INTEGER, clock_out INTEGER,
          reason text not null, status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
          requested_at INTEGER not null, decided_at INTEGER, decided_by integer references employees(id)
        ) STRICT;
        create index hr_request_employee_days on hr_requests (employee_id, day_from, day_to);

        create table work_logs (
          id INTEGER PRIMARY KEY,
          employee_id integer not null references employees(id), day text not null,
          note text not null, minutes integer not null check (minutes between 0 and 1440), created_at INTEGER not null
        ) STRICT;
        create index work_log_employee_day on work_logs (employee_id, day);

        create table payslips (
          id INTEGER PRIMARY KEY,
          employee_id integer not null references employees(id),
          period text not null, gross_paise INTEGER not null check (gross_paise >= 0), deductions_paise INTEGER not null,
          note text, published_at INTEGER not null, unique (employee_id, period),
          check (deductions_paise between 0 and gross_paise)
        ) STRICT;

        create table announcements (
          id INTEGER PRIMARY KEY,
          title text not null, message text not null, published_at INTEGER not null
        ) STRICT;
        CREATE TABLE shoot_crew (
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          PRIMARY KEY (task_id, employee_id)
        ) STRICT;
        CREATE INDEX shoot_crew_employee ON shoot_crew (employee_id, task_id);
        CREATE VIEW task_assignments AS
          SELECT id AS task_id, employee_id FROM tasks WHERE is_open = 0
          UNION
          SELECT shoot_crew.task_id, shoot_crew.employee_id FROM shoot_crew
            JOIN tasks ON tasks.id = shoot_crew.task_id WHERE tasks.is_open = 0;

        ALTER TABLE reminders RENAME TO old_reminders;
        CREATE TABLE reminders (
          task_id INTEGER NOT NULL REFERENCES tasks(id),
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          sent_at INTEGER NOT NULL, read_at INTEGER,
          PRIMARY KEY (task_id, employee_id)
        ) STRICT;
        INSERT INTO reminders SELECT task_id, employee_id, sent_at, read_at FROM old_reminders;
        DROP TABLE old_reminders;
        PRAGMA user_version = 4;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 5) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN parent_shoot_id INTEGER REFERENCES tasks(id);
        ALTER TABLE tasks ADD COLUMN delivery_due_at INTEGER;
        ALTER TABLE tasks ADD COLUMN payment_due_on TEXT;
        CREATE UNIQUE INDEX one_editing_schedule_per_shoot ON tasks (parent_shoot_id) WHERE parent_shoot_id IS NOT NULL;
        PRAGMA user_version = 5;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 6) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN additional_sites TEXT NOT NULL DEFAULT '[]' CHECK (json_type(additional_sites) = 'array');
        PRAGMA user_version = 6;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 7) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE INDEX attendance_employee_date ON attendance(employee_id, clock_in DESC);
        CREATE INDEX task_employee_date ON tasks(employee_id, start_at);
        CREATE INDEX payment_task ON payments(task_id);
        CREATE INDEX auth_session_expiry ON auth_sessions(expires_at);
        CREATE UNIQUE INDEX one_active_admin ON employees(is_admin) WHERE is_admin = 1 AND archived = 0;
        CREATE TABLE login_limits (
          key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX login_limit_expiry ON login_limits(reset_at);

        ALTER TABLE tasks ADD COLUMN calendar_sequence INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tasks ADD COLUMN calendar_updated_at INTEGER NOT NULL DEFAULT 0;
        UPDATE tasks SET calendar_updated_at = start_at;
        CREATE TABLE calendar_feeds (
          employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_read_at INTEGER
        ) STRICT;
        CREATE TRIGGER initialize_task_calendar AFTER INSERT ON tasks WHEN NEW.calendar_updated_at = 0
        BEGIN
          UPDATE tasks SET calendar_updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
        END;
        CREATE TRIGGER update_task_calendar AFTER UPDATE OF title, employee_id, start_at, estimate, location, priority,
          is_open, shoot_status, additional_sites ON tasks
        WHEN (OLD.title, OLD.employee_id, OLD.start_at, OLD.estimate, OLD.location, OLD.priority, OLD.is_open, OLD.shoot_status, OLD.additional_sites)
           IS NOT (NEW.title, NEW.employee_id, NEW.start_at, NEW.estimate, NEW.location, NEW.priority, NEW.is_open, NEW.shoot_status, NEW.additional_sites)
        BEGIN
          UPDATE tasks SET calendar_sequence = OLD.calendar_sequence + 1,
            calendar_updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id;
        END;
        CREATE TRIGGER revoke_calendar_on_identity_change AFTER UPDATE OF email, archived ON employees
        WHEN OLD.email != NEW.email OR OLD.archived != NEW.archived
        BEGIN
          DELETE FROM calendar_feeds WHERE employee_id = NEW.id;
          DELETE FROM push_subscriptions WHERE employee_id = NEW.id;
        END;

        CREATE TABLE push_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1), vapid_public_key TEXT, vapid_private_key TEXT
        ) STRICT;
        INSERT INTO push_settings (id) VALUES (1);
        CREATE TABLE push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth_secret TEXT NOT NULL, last_test_at INTEGER
        ) STRICT;
        CREATE INDEX push_subscription_employee ON push_subscriptions(employee_id);
        CREATE TABLE push_deliveries (
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          start_at INTEGER NOT NULL, subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, sent_at INTEGER,
          PRIMARY KEY (task_id, employee_id, start_at, subscription_id)
        ) STRICT;
        CREATE INDEX push_delivery_due ON push_deliveries(next_attempt_at) WHERE sent_at IS NULL;
        PRAGMA user_version = 7;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 8) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE hr_settings ADD COLUMN required_minutes INTEGER NOT NULL DEFAULT 480 CHECK (required_minutes BETWEEN 0 AND 1440);
        ALTER TABLE hr_settings ADD COLUMN verification_grace_minutes INTEGER NOT NULL DEFAULT 5 CHECK (verification_grace_minutes BETWEEN 2 AND 60);
        ALTER TABLE attendance ADD COLUMN last_verified_at INTEGER;
        CREATE TABLE attendance_gaps (
          id INTEGER PRIMARY KEY, attendance_id INTEGER NOT NULL REFERENCES attendance(id),
          start_at INTEGER NOT NULL, resolved_at INTEGER
        ) STRICT;
        CREATE UNIQUE INDEX attendance_open_gap ON attendance_gaps (attendance_id) WHERE resolved_at IS NULL;
        PRAGMA user_version = 8;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 9) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE employees ADD COLUMN deactivated INTEGER NOT NULL DEFAULT 0 CHECK (deactivated IN (0, 1));
        CREATE TABLE access_audit (
          id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES employees(id), subject_id INTEGER REFERENCES employees(id),
          action TEXT NOT NULL, occurred_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX access_audit_date ON access_audit(occurred_at DESC);
        CREATE TABLE personal_notes (
          employee_id INTEGER PRIMARY KEY REFERENCES employees(id), note TEXT NOT NULL, updated_at INTEGER NOT NULL
        ) STRICT;
        PRAGMA user_version = 9;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 10) installOperationsSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 11) installHoursSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 12) installGeofenceSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 13) installLocalFilesSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 14) installFootageSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 15) installRevenueSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 16) installProjectSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 17) installDelegationSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 18) installOfflineAttendanceSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 19) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN is_unscheduled INTEGER NOT NULL DEFAULT 0 CHECK(is_unscheduled IN (0,1));
        PRAGMA user_version = 19;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (db.prepare('PRAGMA user_version').get().user_version < 20) installOperationPushSchema(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 21) installOfflineKeys(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 22) installScopedAccess(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 23) installProfilePhotos(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 24) installAuditHistory(db);
  if (db.prepare('PRAGMA user_version').get().user_version < 25) installBusinessSettings(db);
  return db;
}
