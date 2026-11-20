import { createHash, timingSafeEqual } from 'node:crypto';
import { authenticatedEmployee, createSession, endSession, hashPassword, passwordMatches } from './accounts.js';
import { mapsLocation } from './maps.js';
import { attendanceTransition, shootSite } from './public/attendance-policy.js';
import { refreshReminders } from './store.js';

const publicEmployee = 'id, name, email, role, phone, color, is_admin, password_hash IS NOT NULL AS has_login';
const categories = ['Photo shoot', 'Editing', 'Planning', 'Studio', 'Other'];
const colors = ['peach', 'lavender', 'sage', 'sand', 'rose'];
const studioDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function text(value, field, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new RequestError(`Enter a valid ${field} (up to ${max} characters).`);
  }
  return value.trim();
}

function optional(value, field, max) {
  return value == null || value === '' || (typeof value === 'string' && !value.trim()) ? null : text(value, field, max);
}

function email(value) {
  const address = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new RequestError('Enter a valid email address.');
  return address;
}

function phone(value) {
  const number = text(value, 'mobile number', 30).replace(/[()\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(number)) throw new RequestError('Enter a valid mobile number.');
  return number;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || !value.trim()) {
    throw new RequestError('Use a password between 12 and 128 characters.');
  }
  return value;
}

function paise(value, allowZero = false) {
  const match = String(value ?? '').trim().match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!match) throw new RequestError('Enter an amount in rupees with up to two decimal places.');
  const total = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!allowZero && !total) throw new RequestError('Enter an amount greater than zero.');
  return total;
}

function ledgerDate(value, now) {
  const date = text(value, 'transaction date', 10);
  const timestamp = Date.parse(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== date || date > studioDate.format(now)) {
    throw new RequestError('Enter a valid transaction date up to today.');
  }
  return date;
}

function adminOnly(actor) {
  if (!actor.is_admin) throw new RequestError('This action is available to the admin only.', 403);
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError('Use application/json.', 415);
  }
  if (req.headers.origin) {
    let origin;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      throw new RequestError('Origin is unavailable.', 403);
    }
    if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) {
      throw new RequestError('Submit this request from the workspace.', 403);
    }
  }
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 32000) throw new RequestError('Request is too large.', 413);
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

function localSetup(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host || '') &&
    !req.headers.forwarded && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'];
}

function setupAllowed(req, supplied) {
  const configured = process.env.ADMIN_SETUP_TOKEN;
  if (!configured) return localSetup(req);
  if (typeof supplied !== 'string') return false;
  const checksum = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(checksum(configured), checksum(supplied));
}

async function siteFrom(body) {
  try {
    return await mapsLocation(body);
  } catch (error) {
    throw new RequestError(error.message);
  }
}

export function createApi(db) {
  const loginAttempts = new Map();
  const secureCookies = process.env.SECURE_COOKIES === '1';

  function throttle(req, now) {
    const key = req.socket.remoteAddress;
    if (loginAttempts.size >= 1024) {
      for (const [address, attempt] of loginAttempts) {
        if (attempt.resetAt <= now) loginAttempts.delete(address);
      }
      if (loginAttempts.size >= 1024 && !loginAttempts.has(key)) throw new RequestError('Try signing in later.', 429);
    }
    let attempt = loginAttempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      attempt = { count: 0, resetAt: now + 5 * 60_000 };
      loginAttempts.set(key, attempt);
    }
    if (attempt.count >= 12) throw new RequestError('Too many sign-in attempts. Try again in a few minutes.', 429);
    attempt.count += 1;
  }

  const needsSetup = () => !db.prepare('SELECT 1 FROM employees WHERE is_admin = 1 AND archived = 0 AND password_hash IS NOT NULL').get();

  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function getEmployee(id) {
    const employee = db.prepare(`SELECT ${publicEmployee} FROM employees WHERE id = ? AND archived = 0`).get(Number(id));
    if (!employee) throw new RequestError('Employee not found.', 404);
    return employee;
  }

  function getTask(id) {
    const task = db.prepare('SELECT tasks.* FROM tasks JOIN employees ON employees.id = tasks.employee_id WHERE tasks.id = ? AND employees.archived = 0').get(Number(id));
    if (!task) throw new RequestError('Shoot or task not found.', 404);
    return task;
  }

  function ownTask(id, actor) {
    const task = getTask(id);
    if (task.is_open || task.employee_id !== actor.id) throw new RequestError('This work has not been assigned to your account.', 403);
    return task;
  }

  function officeSite() {
    return db.prepare('SELECT name, latitude, longitude, maps_url FROM office WHERE id = 1').get() ?? null;
  }

  function overview(actor, now) {
    refreshReminders(db, now);
    const manager = actor.is_admin;
    const employees = manager
      ? db.prepare(`SELECT ${publicEmployee} FROM employees WHERE archived = 0 ORDER BY name`).all()
      : [getEmployee(actor.id)];
    const taskQuery = `
      SELECT tasks.id, title, employee_id, start_at, estimate, location, category, completed_at,
        site_latitude, site_longitude, maps_url, priority, is_open, clients.name AS client_name, clients.phone AS client_phone
        ${manager ? ', client_id, income_paise' : ''}
      FROM tasks JOIN employees ON employees.id = tasks.employee_id LEFT JOIN clients ON clients.id = tasks.client_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND tasks.employee_id = ? AND tasks.is_open = 0'}
      ORDER BY completed_at IS NOT NULL, priority DESC, start_at, tasks.id
    `;
    const visibleTasks = db.prepare(taskQuery).all(...(manager ? [] : [actor.id]));
    const attendance = db.prepare(`
      SELECT attendance.* FROM attendance JOIN employees ON employees.id = attendance.employee_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND employee_id = ?'}
      ORDER BY clock_in DESC, attendance.id DESC
    `).all(...(manager ? [] : [actor.id]));
    const sessions = db.prepare(`
      SELECT task_sessions.* FROM task_sessions JOIN employees ON employees.id = task_sessions.employee_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND employee_id = ?'}
      ORDER BY start_at DESC
    `).all(...(manager ? [] : [actor.id]));
    const requests = db.prepare(`
      SELECT work_requests.*, tasks.title FROM work_requests
      JOIN tasks ON tasks.id = work_requests.task_id
      JOIN employees ON employees.id = work_requests.employee_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND work_requests.employee_id = ?'}
      ORDER BY status != 'pending', requested_at DESC
    `).all(...(manager ? [] : [actor.id]));
    const openWork = manager ? [] : db.prepare(`
      SELECT id, title, start_at, estimate, category FROM tasks
      WHERE is_open = 1 AND completed_at IS NULL AND start_at + estimate * 60000 > ?
      ORDER BY start_at
    `).all(now);
    return {
      actor, office: officeSite(), employees, tasks: visibleTasks, attendance, sessions, requests, openWork,
      reminders: db.prepare(`
        SELECT reminders.*, tasks.title, tasks.start_at FROM reminders JOIN tasks ON tasks.id = reminders.task_id
        WHERE reminders.employee_id = ? AND tasks.employee_id = ? AND tasks.is_open = 0 ORDER BY sent_at DESC
      `).all(actor.id, actor.id),
      ...(manager ? {
        clients: db.prepare('SELECT * FROM clients ORDER BY name').all(),
        payments: db.prepare('SELECT * FROM payments ORDER BY paid_on DESC, id DESC').all(),
        expenses: db.prepare('SELECT * FROM expenses ORDER BY spent_on DESC, id DESC').all(),
      } : {}),
    };
  }

  async function bootstrap(req, res, body, now) {
    if (!needsSetup()) throw new RequestError('The admin account is already set up.', 409);
    throttle(req, now);
    if (!setupAllowed(req, body.setupToken)) {
      throw new RequestError('Set up the admin from localhost or enter the server’s setup token.', 403);
    }
    const name = text(body.name, 'admin name');
    const address = email(body.email);
    const hash = await hashPassword(password(body.password));
    const id = transaction(() => {
      if (!needsSetup()) throw new RequestError('The admin account is already set up.', 409);
      const existing = db.prepare('SELECT id, archived FROM employees WHERE email = ?').get(address);
      if (existing?.archived) throw new RequestError('Use your company email for the admin account.');
      if (existing) {
        db.prepare("UPDATE employees SET name = ?, role = 'Administrator', is_admin = 1, password_hash = ? WHERE id = ?")
          .run(name, hash, existing.id);
        return existing.id;
      }
      return db.prepare(`
        INSERT INTO employees (name, email, role, color, is_admin, password_hash)
        VALUES (?, ?, 'Administrator', 'peach', 1, ?) RETURNING id
      `).get(name, address, hash).id;
    });
    loginAttempts.delete(req.socket.remoteAddress);
    res.setHeader('Set-Cookie', createSession(db, id, now, secureCookies));
    return { ok: true };
  }

  async function signIn(req, res, body, now) {
    throttle(req, now);
    const address = email(body.email);
    if (typeof body.password !== 'string' || body.password.length > 128) throw new RequestError('Invalid email or password.', 401);
    const person = db.prepare('SELECT id, password_hash FROM employees WHERE email = ? AND archived = 0').get(address);
    if (!await passwordMatches(body.password, person?.password_hash)) throw new RequestError('Invalid email or password.', 401);
    // Recheck in case an admin reset the credential while verification was running.
    if (db.prepare('SELECT password_hash FROM employees WHERE id = ? AND archived = 0').get(person.id)?.password_hash !== person.password_hash) {
      throw new RequestError('Invalid email or password.', 401);
    }
    loginAttempts.delete(req.socket.remoteAddress);
    res.setHeader('Set-Cookie', createSession(db, person.id, now, secureCookies));
    return { ok: true };
  }

  async function saveEmployee(body) {
    const existing = body.id ? getEmployee(body.id) : null;
    if (existing?.is_admin) throw new RequestError('The admin account is managed separately.');
    const name = text(body.name, 'name');
    const role = text(body.role, 'job role');
    const address = email(body.email);
    const mobile = body.phone ? phone(body.phone) : null;
    const hash = body.password || !existing?.has_login ? await hashPassword(password(body.password)) : null;
    return transaction(() => {
      const duplicate = db.prepare('SELECT id FROM employees WHERE email = ?').get(address);
      if (duplicate && duplicate.id !== existing?.id) throw new RequestError('That email is already in use.', 409);
      if (existing) {
        const updated = db.prepare(`
          UPDATE employees SET name = ?, role = ?, email = ?, phone = ?, password_hash = COALESCE(?, password_hash)
          WHERE id = ? RETURNING ${publicEmployee}
        `).get(name, role, address, mobile, hash, existing.id);
        if (hash || address !== existing.email) db.prepare('DELETE FROM auth_sessions WHERE employee_id = ?').run(existing.id);
        return updated;
      }
      const count = db.prepare('SELECT COUNT(*) AS total FROM employees WHERE archived = 0').get().total;
      return db.prepare(`
        INSERT INTO employees (name, role, email, phone, color, password_hash) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING ${publicEmployee}
      `).get(name, role, address, mobile, colors[count % colors.length], hash);
    });
  }

  function saveClient(body) {
    const name = text(body.name, 'client name');
    const mobile = phone(body.phone);
    const address = optional(body.email, 'email', 254) ? email(body.email) : null;
    const notes = optional(body.notes, 'client notes', 1000);
    const existing = db.prepare('SELECT id FROM clients WHERE phone = ?').get(mobile);
    if (existing && existing.id !== Number(body.id)) throw new RequestError('A client already uses that mobile number.', 409);
    const client = body.id
      ? db.prepare('UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? RETURNING *').get(name, mobile, address, notes, Number(body.id))
      : db.prepare('INSERT INTO clients (name, phone, email, notes) VALUES (?, ?, ?, ?) RETURNING *').get(name, mobile, address, notes);
    if (!client) throw new RequestError('Client not found.', 404);
    return client;
  }

  function clientForTask(body) {
    if (body.clientId) {
      const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(Number(body.clientId));
      if (!existing) throw new RequestError('Choose a valid client.');
      return existing.id;
    }
    const name = text(body.clientName, 'shoot owner name');
    const mobile = phone(body.clientPhone);
    const existing = db.prepare('SELECT id, name FROM clients WHERE phone = ?').get(mobile);
    if (existing) {
      if (existing.name.toLowerCase() !== name.toLowerCase()) throw new RequestError('This number belongs to an existing client. Select that client or update their details.');
      return existing.id;
    }
    return db.prepare('INSERT INTO clients (name, phone) VALUES (?, ?) RETURNING id').get(name, mobile).id;
  }

  async function saveTask(body, actor, now) {
    const title = text(body.title, 'work title');
    const location = text(body.location, 'location name');
    const category = text(body.category, 'work category');
    if (!categories.includes(category)) throw new RequestError('Choose a valid work category.');
    const estimate = Number(body.estimate);
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 1440) {
      throw new RequestError('Enter a duration from 1 to 1,440 minutes.');
    }
    const startAt = Date.parse(body.startAt);
    if (!Number.isFinite(startAt)) throw new RequestError('Choose a valid start date and time.');
    const isShoot = category === 'Photo shoot';
    const isOpen = body.assignment === 'open';
    const employee = isOpen ? actor : getEmployee(body.employeeId);
    if (!isOpen && !employee.has_login && !employee.is_admin) throw new RequestError('Set up this employee’s login before assigning work.');
    const site = isShoot ? await siteFrom(body) : null;
    const income = isShoot ? paise(body.income, true) : 0;
    return transaction(() => {
      const current = body.id ? getTask(body.id) : null;
      if (current) {
        if (current.completed_at) throw new RequestError('Completed work cannot be rescheduled.', 409);
        if (current.category !== category) throw new RequestError('Keep the original work category when editing.');
        const hasTime = db.prepare('SELECT 1 FROM task_sessions WHERE task_id = ?').get(current.id);
        if (hasTime && (isOpen || employee.id !== current.employee_id)) throw new RequestError('Work with recorded time cannot be reassigned.', 409);
        if (hasTime && (current.site_latitude !== (site?.latitude ?? null) || current.site_longitude !== (site?.longitude ?? null))) {
          throw new RequestError('The site cannot change after work time has been recorded.', 409);
        }
        const paid = db.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE task_id = ?').get(current.id).total;
        if (income < paid) throw new RequestError('Shoot income cannot be lower than payments already received.');
      }
      const clientId = isShoot ? clientForTask(body) : null;
      const values = [title, employee.id, startAt, estimate, location, category, site?.latitude ?? null,
        site?.longitude ?? null, site?.maps_url ?? null, clientId, income, Number(!isOpen), Number(isOpen)];
      let task;
      if (current) {
        task = db.prepare(`
          UPDATE tasks SET title = ?, employee_id = ?, start_at = ?, estimate = ?, location = ?, category = ?,
            site_latitude = ?, site_longitude = ?, maps_url = ?, client_id = ?, income_paise = ?, priority = ?, is_open = ?
          WHERE id = ? RETURNING *
        `).get(...values, current.id);
        if (current.start_at !== startAt || current.employee_id !== employee.id || isOpen) {
          db.prepare('DELETE FROM reminders WHERE task_id = ?').run(task.id);
        }
        if (!isOpen) db.prepare("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND status = 'pending'").run(now, task.id);
      } else {
        task = db.prepare(`
          INSERT INTO tasks (title, employee_id, start_at, estimate, location, category, site_latitude,
            site_longitude, maps_url, client_id, income_paise, priority, is_open)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
        `).get(...values);
      }
      refreshReminders(db, now);
      return task;
    });
  }

  function submitRequest(body, actor, now) {
    if (actor.is_admin) throw new RequestError('Admins can assign work from the schedule.', 403);
    const task = getTask(body.taskId);
    if (!task.is_open || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
    const note = optional(body.note, 'request note', 500);
    const request = db.prepare(`
      INSERT INTO work_requests (task_id, employee_id, note, requested_at, status)
      VALUES (?, ?, ?, ?, 'pending') ON CONFLICT (task_id, employee_id) DO NOTHING RETURNING *
    `).get(task.id, actor.id, note, now);
    if (!request) throw new RequestError('You have already requested this work.', 409);
    return request;
  }

  function decideRequest(body, now) {
    if (!['approved', 'declined'].includes(body.status)) throw new RequestError('Choose approve or decline.');
    return transaction(() => {
      const request = db.prepare('SELECT * FROM work_requests WHERE id = ?').get(Number(body.id));
      if (request?.status !== 'pending') throw new RequestError('This request is no longer pending.', 409);
      const task = getTask(request.task_id);
      if (body.status === 'approved') {
        if (!task.is_open || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
        getEmployee(request.employee_id);
        db.prepare('UPDATE tasks SET employee_id = ?, is_open = 0, priority = 1 WHERE id = ?').run(request.employee_id, task.id);
        db.prepare("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND id != ? AND status = 'pending'")
          .run(now, task.id, request.id);
        refreshReminders(db, now);
      }
      return db.prepare('UPDATE work_requests SET status = ?, decided_at = ? WHERE id = ? RETURNING *')
        .get(body.status, now, request.id);
    });
  }

  function recordPayment(body, now) {
    const amount = paise(body.amount);
    const date = ledgerDate(body.date, now);
    const note = optional(body.note, 'payment reference', 300);
    return transaction(() => {
      const existing = body.id ? db.prepare('SELECT id, task_id, amount_paise FROM payments WHERE id = ?').get(Number(body.id)) : null;
      if (body.id && !existing) throw new RequestError('Payment not found.', 404);
      const task = getTask(existing?.task_id ?? body.taskId);
      if (task.category !== 'Photo shoot') throw new RequestError('Choose a shoot to record payment.');
      const paid = db.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE task_id = ?').get(task.id).total;
      if (amount > task.income_paise - paid + (existing?.amount_paise ?? 0)) {
        throw new RequestError('Payment exceeds the outstanding balance.');
      }
      if (existing) {
        return db.prepare('UPDATE payments SET amount_paise = ?, paid_on = ?, note = ? WHERE id = ? RETURNING *')
          .get(amount, date, note, existing.id);
      }
      return db.prepare('INSERT INTO payments (task_id, amount_paise, paid_on, note) VALUES (?, ?, ?, ?) RETURNING *')
        .get(task.id, amount, date, note);
    });
  }
  function recordAttendance(employeeId, command, now) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const latest = db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1').get(employeeId);
      const tasks = db.prepare("SELECT * FROM tasks WHERE employee_id = ? AND category = 'Photo shoot' AND is_open = 0").all(employeeId);
      const change = attendanceTransition({ command, latest, office: officeSite(), tasks, employeeId, now });
      let shift = null;
      if (change?.type === 'open') {
        db.prepare('UPDATE attendance SET resume_pending = 0 WHERE employee_id = ? AND resume_pending = 1').run(employeeId);
        shift = db.prepare(`
          INSERT INTO attendance (employee_id, clock_in, in_location, site, in_reason)
          VALUES (?, ?, ?, ?, ?) RETURNING *
        `).get(employeeId, now, JSON.stringify(change.location), JSON.stringify(change.site), change.reason);
        if (change.site.taskId) {
          db.prepare('UPDATE task_sessions SET end_at = ? WHERE employee_id = ? AND end_at IS NULL').run(now, employeeId);
          db.prepare('INSERT INTO task_sessions (task_id, employee_id, start_at) VALUES (?, ?, ?)')
            .run(change.site.taskId, employeeId, now);
        }
      }
      if (change?.type === 'close') {
        shift = db.prepare(`
          UPDATE attendance SET clock_out = ?, out_location = ?, out_reason = ?, resume_pending = ? WHERE id = ? RETURNING *
        `).get(now, JSON.stringify(change.location), change.reason, Number(change.reason === 'geofence'), change.shiftId);
        if (change.taskId) {
          db.prepare('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND employee_id = ? AND end_at IS NULL')
            .run(now, change.taskId, employeeId);
        }
      }
      if (change?.type === 'cancel') {
        db.prepare('UPDATE attendance SET resume_pending = 0 WHERE id = ?').run(change.shiftId);
      }
      db.exec('COMMIT');
      return shift;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function taskAction(body, actor, now) {
    const task = ownTask(body.taskId, actor);
    if (task.completed_at) throw new RequestError('This work is already complete.', 409);
    const active = db.prepare('SELECT * FROM task_sessions WHERE employee_id = ? AND end_at IS NULL').get(actor.id);
    if (body.action === 'start' || (body.action === 'complete' && task.category === 'Photo shoot')) {
      if (task.category === 'Photo shoot') {
        const current = db.prepare('SELECT site FROM attendance WHERE employee_id = ? AND clock_out IS NULL').get(actor.id);
        if (!shootSite(task) || !current?.site || JSON.parse(current.site).taskId !== task.id) {
          throw new RequestError('Clock in at this shoot before working on it.', 409);
        }
      }
    }
    if (body.action === 'start') {
      if (active) throw new RequestError('Pause the running task before starting another.', 409);
      return db.prepare('INSERT INTO task_sessions (task_id, employee_id, start_at) VALUES (?, ?, ?) RETURNING *')
        .get(task.id, actor.id, now);
    }
    if (body.action === 'pause' && active?.task_id === task.id) {
      return db.prepare('UPDATE task_sessions SET end_at = ? WHERE id = ? RETURNING *').get(now, active.id);
    }
    if (body.action === 'complete') {
      return transaction(() => {
        if (active?.task_id === task.id) db.prepare('UPDATE task_sessions SET end_at = ? WHERE id = ?').run(now, active.id);
        return db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *').get(now, task.id);
      });
    }
    throw new RequestError('This work action is unavailable.', 409);
  }

  return async function api(req, res, path) {
    const now = Date.now();
    const actor = authenticatedEmployee(db, req, now);
    if (req.method === 'GET' && path === '/api/session') {
      const setup = needsSetup();
      return { actor, needsSetup: setup, requiresSetupToken: setup && (Boolean(process.env.ADMIN_SETUP_TOKEN) || !localSetup(req)) };
    }
    if (req.method === 'GET' && path === '/api/state') {
      if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
      return overview(actor, now);
    }
    if (req.method !== 'POST') throw new RequestError('Route not found.', 404);
    const body = await readBody(req);
    if (path === '/api/bootstrap') return bootstrap(req, res, body, now);
    if (path === '/api/login') return signIn(req, res, body, now);
    if (path === '/api/logout') {
      res.setHeader('Set-Cookie', endSession(db, req, secureCookies));
      return { ok: true };
    }
    if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
    if (path === '/api/attendance') {
      if (body.taskId != null && body.action === 'in') ownTask(body.taskId, actor);
      return recordAttendance(actor.id, body, now);
    }
    if (path === '/api/task-action') return taskAction(body, actor, now);
    if (path === '/api/work-requests') return submitRequest(body, actor, now);
    if (path === '/api/reminders/read') {
      db.prepare('UPDATE reminders SET read_at = ? WHERE employee_id = ? AND read_at IS NULL').run(now, actor.id);
      return { ok: true };
    }
    adminOnly(actor);
    if (path === '/api/employees') return saveEmployee(body);
    if (path === '/api/clients') return saveClient(body);
    if (path === '/api/tasks') return saveTask(body, actor, now);
    if (path === '/api/request-decisions') return decideRequest(body, now);
    if (path === '/api/payments') return recordPayment(body, now);
    if (path === '/api/expenses') {
      const values = [text(body.name, 'expense name'), text(body.category, 'expense category'), paise(body.amount),
        ledgerDate(body.date, now), optional(body.note, 'expense notes', 300)];
      const entry = body.id
        ? db.prepare('UPDATE expenses SET name = ?, category = ?, amount_paise = ?, spent_on = ?, note = ? WHERE id = ? RETURNING *').get(...values, Number(body.id))
        : db.prepare('INSERT INTO expenses (name, category, amount_paise, spent_on, note) VALUES (?, ?, ?, ?, ?) RETURNING *').get(...values);
      if (!entry) throw new RequestError('Expense not found.', 404);
      return entry;
    }
    if (path === '/api/office') {
      const name = text(body.name, 'office name');
      const site = await siteFrom(body);
      return db.prepare(`
        INSERT INTO office (id, name, latitude, longitude, maps_url) VALUES (1, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude,
          longitude = excluded.longitude, maps_url = excluded.maps_url
        RETURNING name, latitude, longitude, maps_url
      `).get(name, site.latitude, site.longitude, site.maps_url);
    }
    throw new RequestError('Route not found.', 404);
  };
}
