import { createHash, randomBytes } from 'node:crypto';
import { additionalShootLocations } from './attendance-policy.js';

const digest = (token) => createHash('sha256').update(token).digest('hex');
const encoder = new TextEncoder();

function calendarText(value) {
  return String(value)
    .replace(/[\u0000-\u0009\u000B-\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');
}

function icalDate(milliseconds) {
  return new Date(milliseconds).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function fold(line) {
  const lines = [];
  let part = '';
  let length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) {
      lines.push(part);
      part = ' ';
      length = 1;
    }
    part += character;
    length += bytes;
  }
  return [...lines, part].join('\r\n');
}

export function formatCalendar(tasks, site) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Concept Photography//Assigned Work//EN',
    'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Concept Photography Schedule'];
  for (const task of tasks) {
    const stamp = icalDate(task.calendar_updated_at);
    const locations = [task.location, ...additionalShootLocations(task).map((location, index) => location.name || `Location ${index + 2}`)];
    lines.push(
      'BEGIN:VEVENT',
      `UID:concept-task-${task.id}@${site.hostname}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `SEQUENCE:${task.calendar_sequence}`,
      `DTSTART:${icalDate(task.start_at)}`,
      `DTEND:${icalDate(task.start_at + task.estimate * 60_000)}`,
      `SUMMARY:${calendarText(task.title)}`,
      `LOCATION:${calendarText(locations.join(' / '))}`,
      `PRIORITY:${task.priority ? 1 : 5}`,
      `URL:${site.href}`,
      'END:VEVENT',
    );
  }
  return [...lines, 'END:VCALENDAR', ''].map(fold).join('\r\n');
}

export function createCalendar({ projectUrl, workspaceUrl, adminAuth }) {
  const scheduleUrl = new URL(workspaceUrl);
  scheduleUrl.hash = 'schedule';

  return {
    async status(db, employeeId) {
      const record = await db.get('SELECT created_at, last_read_at FROM calendar_feeds WHERE employee_id = ?', employeeId);
      return { enabled: Boolean(record), lastReadAt: record?.last_read_at ?? null };
    },

    async employees(db) {
      return db.all('SELECT employee_id, last_read_at FROM calendar_feeds');
    },

    async issue(db, actor) {
      const token = randomBytes(32).toString('hex');
      const linked = await db.transaction((store) => store.get(`
        INSERT INTO calendar_feeds (employee_id, token_hash, created_at)
        SELECT id, ?, ? FROM employees WHERE id = ? AND email = ? AND archived = 0
        ON CONFLICT (employee_id) DO UPDATE SET
          token_hash = excluded.token_hash, created_at = excluded.created_at, last_read_at = NULL
        RETURNING employee_id
      `, digest(token), Date.now(), actor.id, actor.email));
      if (!linked) {
        const error = new Error('Sign in again to connect your calendar.');
        error.status = 401;
        throw error;
      }
      const url = new URL(`/functions/v1/concept-api/calendar/${token}.ics`, projectUrl);
      return { enabled: true, lastReadAt: null, url: url.href };
    },

    async revoke(db, employeeId) {
      await db.run('DELETE FROM calendar_feeds WHERE employee_id = ?', employeeId);
      return { enabled: false, lastReadAt: null };
    },

    async read(db, token, { track = true } = {}) {
      if (!/^[a-f0-9]{64}$/.test(token)) return null;
      const tokenHash = digest(token);
      const owner = await db.get(`
        SELECT employees.id, employees.is_admin
        FROM calendar_feeds JOIN employees ON employees.id = calendar_feeds.employee_id
        WHERE token_hash = ? AND employees.archived = 0
      `, tokenHash);
      if (!owner || (owner.is_admin && !await adminAuth.identity(db, owner.id))) return null;
      const assignments = await db.all(`
        SELECT tasks.id, title, location, additional_sites, start_at, estimate, priority, calendar_updated_at, calendar_sequence
        FROM tasks JOIN task_assignments ON task_assignments.task_id = tasks.id
        JOIN calendar_feeds ON calendar_feeds.employee_id = task_assignments.employee_id
        JOIN employees ON employees.id = task_assignments.employee_id
        WHERE calendar_feeds.token_hash = ? AND employees.archived = 0 AND tasks.is_open = 0 AND tasks.shoot_status = 'booked'
        ORDER BY start_at, tasks.id
      `, tokenHash);
      if (track) {
        await db.run(`
          UPDATE calendar_feeds SET last_read_at = ?
          WHERE employee_id = ? AND token_hash = ? AND (last_read_at IS NULL OR last_read_at < ?)
        `, Date.now(), owner.id, tokenHash, Date.now() - 60_000);
      }
      return formatCalendar(assignments, scheduleUrl);
    },
  };
}
