import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, refreshReminders } from './store.js';

const root = dirname(fileURLToPath(import.meta.url));
const database = process.env.DATABASE_PATH || resolve(root, 'data/workforce.sqlite');
if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
const db = openStore(new DatabaseSync(database));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requiredText(value, field, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new RequestError(`Enter a valid ${field} (up to ${max} characters).`);
  }
  return value.trim();
}

function getEmployee(id) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(id));
  if (!employee) throw new RequestError('Employee not found.', 404);
  return employee;
}

function getTask(id) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) throw new RequestError('Task not found.', 404);
  return task;
}

function parseLocation(value) {
  const { latitude, longitude, accuracy } = value ?? {};
  if (![latitude, longitude, accuracy].every(Number.isFinite) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) {
    throw new RequestError('A valid location is required to record attendance.');
  }
  return JSON.stringify({ latitude, longitude, accuracy });
}

async function readBody(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 16000) throw new RequestError('Request is too large.', 413);
    parts.push(part);
  }
  try {
    const body = JSON.parse(Buffer.concat(parts).toString());
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new RequestError('Send a valid JSON object.');
  }
}

function overview() {
  refreshReminders(db);
  return {
    employees: db.prepare('SELECT * FROM employees ORDER BY id').all(),
    tasks: db.prepare('SELECT * FROM tasks ORDER BY start_at, id').all(),
    sessions: db.prepare('SELECT * FROM task_sessions ORDER BY start_at DESC').all(),
    attendance: db.prepare('SELECT * FROM attendance ORDER BY clock_in DESC').all(),
    reminders: db.prepare('SELECT reminders.*, tasks.title, tasks.start_at FROM reminders JOIN tasks ON tasks.id = reminders.task_id ORDER BY sent_at DESC').all(),
  };
}

async function api(req, path) {
  if (req.method === 'GET' && path === '/api/state') return overview();
  if (req.method !== 'POST') throw new RequestError('Route not found.', 404);
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new RequestError('Use application/json.', 415);
  }
  const body = await readBody(req);
  const now = Date.now();

  if (path === '/api/employees') {
    const name = requiredText(body.name, 'name');
    const role = requiredText(body.role, 'role');
    const email = requiredText(body.email, 'email', 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('Enter a valid email.');
    if (db.prepare('SELECT id FROM employees WHERE email = ? COLLATE NOCASE').get(email)) {
      throw new RequestError('An employee with that email already exists.', 409);
    }
    const colors = ['peach', 'lavender', 'sage', 'sand', 'rose'];
    const count = db.prepare('SELECT COUNT(*) AS total FROM employees').get().total;
    return db.prepare('INSERT INTO employees (name, role, email, color) VALUES (?, ?, ?, ?) RETURNING *')
      .get(name, role, email, colors[count % colors.length]);
  }

  if (path === '/api/tasks') {
    const employee = getEmployee(body.employeeId);
    const title = requiredText(body.title, 'task title');
    const location = requiredText(body.location, 'work location');
    const category = requiredText(body.category, 'category');
    if (!['Photo shoot', 'Editing', 'Planning', 'Studio', 'Other'].includes(category)) {
      throw new RequestError('Choose a valid task category.');
    }
    const estimate = Number(body.estimate);
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 1440) {
      throw new RequestError('Enter an estimate from 1 to 1,440 minutes.');
    }
    const startAt = Date.parse(body.startAt);
    if (!Number.isFinite(startAt)) throw new RequestError('Choose a valid start date and time.');
    const task = db.prepare(`
      INSERT INTO tasks (title, employee_id, start_at, estimate, location, category)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING *
    `).get(title, employee.id, startAt, estimate, location, category);
    refreshReminders(db, now);
    return task;
  }

  if (path === '/api/attendance') {
    const employee = getEmployee(body.employeeId);
    const location = parseLocation(body.location);
    const current = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL').get(employee.id);
    if (body.action === 'in' && !current) {
      return db.prepare('INSERT INTO attendance (employee_id, clock_in, in_location) VALUES (?, ?, ?) RETURNING *')
        .get(employee.id, now, location);
    }
    if (body.action === 'out' && current) {
      return db.prepare('UPDATE attendance SET clock_out = ?, out_location = ? WHERE id = ? RETURNING *')
        .get(now, location, current.id);
    }
    throw new RequestError('The clock status changed. Refresh and try again.', 409);
  }

  if (path === '/api/task-action') {
    const task = getTask(body.taskId);
    if (task.employee_id !== getEmployee(body.employeeId).id) {
      throw new RequestError('Switch to the assigned employee to update this task.', 403);
    }
    if (task.completed_at) throw new RequestError('This task is already complete.', 409);
    const active = db.prepare('SELECT * FROM task_sessions WHERE employee_id = ? AND end_at IS NULL').get(task.employee_id);
    if (body.action === 'start') {
      if (active) throw new RequestError('Pause the running task before starting another.', 409);
      return db.prepare('INSERT INTO task_sessions (task_id, employee_id, start_at) VALUES (?, ?, ?) RETURNING *')
        .get(task.id, task.employee_id, now);
    }
    if (body.action === 'pause' && active?.task_id === task.id) {
      return db.prepare('UPDATE task_sessions SET end_at = ? WHERE id = ? RETURNING *').get(now, active.id);
    }
    if (body.action === 'complete') {
      db.exec('BEGIN');
      try {
        if (active?.task_id === task.id) db.prepare('UPDATE task_sessions SET end_at = ? WHERE id = ?').run(now, active.id);
        const completed = db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *').get(now, task.id);
        db.exec('COMMIT');
        return completed;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    throw new RequestError('This task action is unavailable.', 409);
  }

  if (path === '/api/reminders/read') {
    const employee = getEmployee(body.employeeId);
    db.prepare('UPDATE reminders SET read_at = ? WHERE employee_id = ? AND read_at IS NULL').run(now, employee.id);
    return { ok: true };
  }

  throw new RequestError('Route not found.', 404);
}

const assets = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/styles.css', ['public/styles.css', 'text/css']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/studio.webp', ['public/studio.webp', 'image/webp']],
  ['/inter.woff2', ['node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'font/woff2']],
  ['/manrope.woff2', ['node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', 'font/woff2']],
]);

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const payload = await api(req, path);
      sendJson(res, 200, payload);
      return;
    }
    const icon = path.match(/^\/icons\/([a-z0-9-]+)\.svg$/);
    const asset = assets.get(path) || (icon && [`node_modules/lucide-static/icons/${icon[1]}.svg`, 'image/svg+xml']);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) throw new RequestError('Page not found.', 404);
    const content = await readFile(resolve(root, asset[0]));
    res.writeHead(200, {
      'Content-Type': asset[1],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
    if (status === 500) console.error(error);
    sendJson(res, status, { error: status === 500 ? 'Something went wrong. Try again.' : error.message });
  }
});

setInterval(() => {
  try {
    refreshReminders(db);
  } catch (error) {
    console.error('Could not refresh work reminders.', error);
  }
}, 15000).unref();

server.listen(port, host, () => console.log(`Concept Photography workspace listening on http://${host}:${server.address().port}`));
