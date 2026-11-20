import { createHash } from 'node:crypto';
import { authenticatedEmployee, createSession, endSession, hashPassword, passwordMatches } from './accounts.js';
import { mapsLocation } from './maps.js';
import { attendanceTransition, shootSite } from './attendance-policy.js';
import { refreshReminders } from './reminders.js';

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

async function readBody(req, siteOrigin) {
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
    const sameOrigin = origin.host === req.headers.host && ['http:', 'https:'].includes(origin.protocol);
    if (siteOrigin ? origin.origin !== siteOrigin : !sameOrigin) {
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

async function siteFrom(body) {
  try {
    return await mapsLocation(body);
  } catch (error) {
    throw new RequestError(error.message);
  }
}

export function createApi(db, { bearer = false, secureCookies = false, adminAuth, siteOrigin } = {}) {
  const loginAttempts = new Map();
  const sessionOptions = { bearer, secureCookies };

  async function throttle(req, now) {
    const key = req.socket.remoteAddress;
    if (bearer) {
      const hash = createHash('sha256').update(key).digest('hex');
      const window = 5 * 60_000;
      const limit = await db.get(`
        INSERT INTO login_limits (key, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN login_limits.reset_at <= ? THEN 1 ELSE LEAST(login_limits.count + 1, 13) END,
          reset_at = CASE WHEN login_limits.reset_at <= ? THEN excluded.reset_at ELSE login_limits.reset_at END
        RETURNING count
      `, hash, now + window, now, now);
      if (limit.count > 12) throw new RequestError('Too many sign-in attempts. Try again in a few minutes.', 429);
      return;
    }
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

  function idValue(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
  }

  async function getEmployee(id, store = db) {
    const employee = await store.get(`SELECT ${publicEmployee} FROM employees WHERE id = ? AND archived = 0`, idValue(id));
    if (!employee) throw new RequestError('Employee not found.', 404);
    return employee;
  }

  async function getTask(id, store = db) {
    const task = await store.get('SELECT tasks.* FROM tasks JOIN employees ON employees.id = tasks.employee_id WHERE tasks.id = ? AND employees.archived = 0', idValue(id));
    if (!task) throw new RequestError('Shoot or task not found.', 404);
    return task;
  }

  async function ownTask(id, actor, store = db) {
    const task = await getTask(id, store);
    if (task.is_open || task.employee_id !== actor.id) throw new RequestError('This work has not been assigned to your account.', 403);
    return task;
  }

  async function officeSite(store = db) {
    return (await store.get('SELECT name, latitude, longitude, maps_url FROM office WHERE id = 1')) ?? null;
  }

  async function overview(actor, now) {
    await db.transaction((store) => refreshReminders(store, now));
    const manager = actor.is_admin;
    const employees = manager
      ? await db.all(`SELECT ${publicEmployee} FROM employees WHERE archived = 0 ORDER BY name`)
      : [await getEmployee(actor.id)];
    const taskQuery = `
      SELECT tasks.id, title, employee_id, start_at, estimate, location, category, completed_at,
        site_latitude, site_longitude, maps_url, priority, is_open, clients.name AS client_name, clients.phone AS client_phone
        ${manager ? ', client_id, income_paise' : ''}
      FROM tasks JOIN employees ON employees.id = tasks.employee_id LEFT JOIN clients ON clients.id = tasks.client_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND tasks.employee_id = ? AND tasks.is_open = 0'}
      ORDER BY completed_at IS NOT NULL, priority DESC, start_at, tasks.id
    `;
    const visibleTasks = await db.all(taskQuery, ...(manager ? [] : [actor.id]));
    const attendance = await db.all(`
      SELECT attendance.* FROM attendance JOIN employees ON employees.id = attendance.employee_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND employee_id = ?'}
      ORDER BY clock_in DESC, attendance.id DESC
    `, ...(manager ? [] : [actor.id]));
    const sessions = await db.all(`
      SELECT task_sessions.* FROM task_sessions JOIN employees ON employees.id = task_sessions.employee_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND employee_id = ?'}
      ORDER BY start_at DESC
    `, ...(manager ? [] : [actor.id]));
    const requests = await db.all(`
      SELECT work_requests.*, tasks.title FROM work_requests
      JOIN tasks ON tasks.id = work_requests.task_id
      JOIN employees ON employees.id = work_requests.employee_id
      WHERE employees.archived = 0 ${manager ? '' : 'AND work_requests.employee_id = ?'}
      ORDER BY status != 'pending', requested_at DESC
    `, ...(manager ? [] : [actor.id]));
    const openWork = manager ? [] : await db.all(`
      SELECT id, title, start_at, estimate, category FROM tasks
      WHERE is_open = 1 AND completed_at IS NULL AND start_at + estimate * 60000 > ?
      ORDER BY start_at
    `, now);
    return {
      actor, office: await officeSite(), employees, tasks: visibleTasks, attendance, sessions, requests, openWork,
      reminders: await db.all(`
        SELECT reminders.*, tasks.title, tasks.start_at FROM reminders JOIN tasks ON tasks.id = reminders.task_id
        WHERE reminders.employee_id = ? AND tasks.employee_id = ? AND tasks.is_open = 0 ORDER BY sent_at DESC
      `, actor.id, actor.id),
      ...(manager ? {
        clients: await db.all('SELECT * FROM clients ORDER BY name'),
        payments: await db.all('SELECT * FROM payments ORDER BY paid_on DESC, id DESC'),
        expenses: await db.all('SELECT * FROM expenses ORDER BY spent_on DESC, id DESC'),
      } : {}),
    };
  }

  async function signIn(req, res, body, now) {
    await throttle(req, now);
    const address = email(body.email);
    const invalidCredentials = () => new RequestError('Invalid email or password.', 401);
    if (typeof body.password !== 'string' || body.password.length > 128) throw invalidCredentials();

    const person = await db.get('SELECT id, is_admin, password_hash FROM employees WHERE email = ? AND archived = 0', address);
    if (person?.is_admin && adminAuth) {
      const identity = await adminAuth.identity(db, person.id);
      if (!identity) throw invalidCredentials();

      let verifiedId;
      try {
        verifiedId = await adminAuth.authenticate(address, body.password);
      } catch {
        throw new RequestError('Supabase sign-in is temporarily unavailable. Try again.', 503);
      }
      if (verifiedId !== identity.auth_user_id) throw invalidCredentials();

      return db.transaction(async (store) => {
        const current = await adminAuth.identity(store, person.id);
        if (current?.auth_user_id !== verifiedId || current.email !== address) throw invalidCredentials();
        return createSession(store, person.id, now, res, sessionOptions);
      });
    }

    if (!await passwordMatches(body.password, person?.password_hash)) throw invalidCredentials();
    // Recheck in case the employee's credentials changed during verification.
    return db.transaction(async (store) => {
      const current = await store.get('SELECT email, password_hash FROM employees WHERE id = ? AND archived = 0', person.id);
      if (!current || current.email !== address || current.password_hash !== person.password_hash) throw invalidCredentials();
      loginAttempts.delete(req.socket.remoteAddress);
      return createSession(store, person.id, now, res, sessionOptions);
    });
  }

  async function saveEmployee(body) {
    const existing = body.id ? await getEmployee(body.id) : null;
    if (existing?.is_admin) throw new RequestError('The admin account is managed separately.');
    const name = text(body.name, 'name');
    const role = text(body.role, 'job role');
    const address = email(body.email);
    const mobile = body.phone ? phone(body.phone) : null;
    const hash = body.password || !existing?.has_login ? await hashPassword(password(body.password)) : null;
    return db.transaction(async (store) => {
      const duplicate = await store.get('SELECT id FROM employees WHERE email = ?', address);
      if (duplicate && duplicate.id !== existing?.id) throw new RequestError('That email is already in use.', 409);
      if (existing) {
        const updated = await store.get(`
          UPDATE employees SET name = ?, role = ?, email = ?, phone = ?, password_hash = COALESCE(?, password_hash)
          WHERE id = ? RETURNING ${publicEmployee}
        `, name, role, address, mobile, hash, existing.id);
        if (hash || address !== existing.email) await store.run('DELETE FROM auth_sessions WHERE employee_id = ?', existing.id);
        return updated;
      }
      const { total: count } = await store.get('SELECT COUNT(*) AS total FROM employees WHERE archived = 0');
      return await store.get(`
        INSERT INTO employees (name, role, email, phone, color, password_hash) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING ${publicEmployee}
      `, name, role, address, mobile, colors[count % colors.length], hash);
    });
  }

  async function saveClient(body) {
    const name = text(body.name, 'client name');
    const mobile = phone(body.phone);
    const address = optional(body.email, 'email', 254) ? email(body.email) : null;
    const notes = optional(body.notes, 'client notes', 1000);
    return db.transaction(async (store) => {
      const existing = await store.get('SELECT id FROM clients WHERE phone = ?', mobile);
      if (existing && existing.id !== idValue(body.id)) throw new RequestError('A client already uses that mobile number.', 409);
      const client = body.id
        ? await store.get('UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? RETURNING *', name, mobile, address, notes, idValue(body.id))
        : await store.get('INSERT INTO clients (name, phone, email, notes) VALUES (?, ?, ?, ?) RETURNING *', name, mobile, address, notes);
      if (!client) throw new RequestError('Client not found.', 404);
      return client;
    });
  }

  async function clientForTask(body, store) {
    if (body.clientId) {
      const existing = await store.get('SELECT id FROM clients WHERE id = ?', idValue(body.clientId));
      if (!existing) throw new RequestError('Choose a valid client.');
      return existing.id;
    }
    const name = text(body.clientName, 'shoot owner name');
    const mobile = phone(body.clientPhone);
    const existing = await store.get('SELECT id, name FROM clients WHERE phone = ?', mobile);
    if (existing) {
      if (existing.name.toLowerCase() !== name.toLowerCase()) throw new RequestError('This number belongs to an existing client. Select that client or update their details.');
      return existing.id;
    }
    return (await store.get('INSERT INTO clients (name, phone) VALUES (?, ?) RETURNING id', name, mobile)).id;
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
    const employee = isOpen ? actor : await getEmployee(body.employeeId);
    if (!isOpen && !employee.has_login && !employee.is_admin) throw new RequestError('Set up this employee’s login before assigning work.');
    const site = isShoot ? await siteFrom(body) : null;
    const income = isShoot ? paise(body.income, true) : 0;
    return db.transaction(async (store) => {
      const current = body.id ? await getTask(body.id, store) : null;
      if (current) {
        if (current.completed_at) throw new RequestError('Completed work cannot be rescheduled.', 409);
        if (current.category !== category) throw new RequestError('Keep the original work category when editing.');
        const hasTime = await store.get('SELECT 1 FROM task_sessions WHERE task_id = ?', current.id);
        if (hasTime && (isOpen || employee.id !== current.employee_id)) throw new RequestError('Work with recorded time cannot be reassigned.', 409);
        if (hasTime && (current.site_latitude !== (site?.latitude ?? null) || current.site_longitude !== (site?.longitude ?? null))) {
          throw new RequestError('The site cannot change after work time has been recorded.', 409);
        }
        const { total: paid } = await store.get('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE task_id = ?', current.id);
        if (income < paid) throw new RequestError('Shoot income cannot be lower than payments already received.');
      }
      const clientId = isShoot ? await clientForTask(body, store) : null;
      const values = [title, employee.id, startAt, estimate, location, category, site?.latitude ?? null,
        site?.longitude ?? null, site?.maps_url ?? null, clientId, income, Number(!isOpen), Number(isOpen)];
      let task;
      if (current) {
        task = await store.get(`
          UPDATE tasks SET title = ?, employee_id = ?, start_at = ?, estimate = ?, location = ?, category = ?,
            site_latitude = ?, site_longitude = ?, maps_url = ?, client_id = ?, income_paise = ?, priority = ?, is_open = ?
          WHERE id = ? RETURNING *
        `, ...values, current.id);
        if (current.start_at !== startAt || current.employee_id !== employee.id || isOpen) {
          await store.run('DELETE FROM reminders WHERE task_id = ?', task.id);
        }
        if (!isOpen) await store.run("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND status = 'pending'", now, task.id);
      } else {
        task = await store.get(`
          INSERT INTO tasks (title, employee_id, start_at, estimate, location, category, site_latitude,
            site_longitude, maps_url, client_id, income_paise, priority, is_open)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
        `, ...values);
      }
      await refreshReminders(store, now);
      return task;
    });
  }

  function submitRequest(body, actor, now) {
    if (actor.is_admin) throw new RequestError('Admins can assign work from the schedule.', 403);
    return db.transaction(async (store) => {
      const task = await getTask(body.taskId, store);
      if (!task.is_open || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
      const note = optional(body.note, 'request note', 500);
      const request = await store.get(`
        INSERT INTO work_requests (task_id, employee_id, note, requested_at, status)
        VALUES (?, ?, ?, ?, 'pending') ON CONFLICT (task_id, employee_id) DO NOTHING RETURNING *
      `, task.id, actor.id, note, now);
      if (!request) throw new RequestError('You have already requested this work.', 409);
      return request;
    });
  }

  function decideRequest(body, now) {
    if (!['approved', 'declined'].includes(body.status)) throw new RequestError('Choose approve or decline.');
    return db.transaction(async (store) => {
      const request = await store.get('SELECT * FROM work_requests WHERE id = ?', idValue(body.id));
      if (request?.status !== 'pending') throw new RequestError('This request is no longer pending.', 409);
      const task = await getTask(request.task_id, store);
      if (body.status === 'approved') {
        if (!task.is_open || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
        await getEmployee(request.employee_id, store);
        await store.run('UPDATE tasks SET employee_id = ?, is_open = 0, priority = 1 WHERE id = ?', request.employee_id, task.id);
        await store.run("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND id != ? AND status = 'pending'", now, task.id, request.id);
        await refreshReminders(store, now);
      }
      return await store.get('UPDATE work_requests SET status = ?, decided_at = ? WHERE id = ? RETURNING *', body.status, now, request.id);
    });
  }

  function recordPayment(body, now) {
    const amount = paise(body.amount);
    const date = ledgerDate(body.date, now);
    const note = optional(body.note, 'payment reference', 300);
    return db.transaction(async (store) => {
      const existing = body.id ? await store.get('SELECT id, task_id, amount_paise FROM payments WHERE id = ?', idValue(body.id)) : null;
      if (body.id && !existing) throw new RequestError('Payment not found.', 404);
      const task = await getTask(existing?.task_id ?? body.taskId, store);
      if (task.category !== 'Photo shoot') throw new RequestError('Choose a shoot to record payment.');
      const { total: paid } = await store.get('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE task_id = ?', task.id);
      if (amount > task.income_paise - paid + (existing?.amount_paise ?? 0)) {
        throw new RequestError('Payment exceeds the outstanding balance.');
      }
      if (existing) {
        return await store.get('UPDATE payments SET amount_paise = ?, paid_on = ?, note = ? WHERE id = ? RETURNING *', amount, date, note, existing.id);
      }
      return await store.get('INSERT INTO payments (task_id, amount_paise, paid_on, note) VALUES (?, ?, ?, ?) RETURNING *', task.id, amount, date, note);
    });
  }
  function recordAttendance(employeeId, command, now) {
    return db.transaction(async (store) => {
      if (command.taskId != null && command.action === 'in') await ownTask(command.taskId, { id: employeeId }, store);
      const latest = await store.get('SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1', employeeId);
      const tasks = await store.all("SELECT * FROM tasks WHERE employee_id = ? AND category = 'Photo shoot' AND is_open = 0", employeeId);
      const change = attendanceTransition({ command, latest, office: await officeSite(store), tasks, employeeId, now });
      let shift = null;
      if (change?.type === 'open') {
        await store.run('UPDATE attendance SET resume_pending = 0 WHERE employee_id = ? AND resume_pending = 1', employeeId);
        shift = await store.get(`
          INSERT INTO attendance (employee_id, clock_in, in_location, site, in_reason)
          VALUES (?, ?, ?, ?, ?) RETURNING *
        `, employeeId, now, JSON.stringify(change.location), JSON.stringify(change.site), change.reason);
        if (change.site.taskId) {
          await store.run('UPDATE task_sessions SET end_at = ? WHERE employee_id = ? AND end_at IS NULL', now, employeeId);
          await store.run('INSERT INTO task_sessions (task_id, employee_id, start_at) VALUES (?, ?, ?)', change.site.taskId, employeeId, now);
        }
      }
      if (change?.type === 'close') {
        shift = await store.get(`
          UPDATE attendance SET clock_out = ?, out_location = ?, out_reason = ?, resume_pending = ? WHERE id = ? RETURNING *
        `, now, JSON.stringify(change.location), change.reason, Number(change.reason === 'geofence'), change.shiftId);
        if (change.taskId) {
          await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND employee_id = ? AND end_at IS NULL', now, change.taskId, employeeId);
        }
      }
      if (change?.type === 'cancel') {
        await store.run('UPDATE attendance SET resume_pending = 0 WHERE id = ?', change.shiftId);
      }
      return shift;
    });
  }

  function taskAction(body, actor, now) {
    return db.transaction(async (store) => {
      const task = await ownTask(body.taskId, actor, store);
      if (task.completed_at) throw new RequestError('This work is already complete.', 409);
      const active = await store.get('SELECT * FROM task_sessions WHERE employee_id = ? AND end_at IS NULL', actor.id);
      if (body.action === 'start' || (body.action === 'complete' && task.category === 'Photo shoot')) {
        if (task.category === 'Photo shoot') {
          const current = await store.get('SELECT site FROM attendance WHERE employee_id = ? AND clock_out IS NULL', actor.id);
          if (!shootSite(task) || !current?.site || JSON.parse(current.site).taskId !== task.id) {
            throw new RequestError('Clock in at this shoot before working on it.', 409);
          }
        }
      }
      if (body.action === 'start') {
        if (active) throw new RequestError('Pause the running task before starting another.', 409);
        return await store.get('INSERT INTO task_sessions (task_id, employee_id, start_at) VALUES (?, ?, ?) RETURNING *', task.id, actor.id, now);
      }
      if (body.action === 'pause' && active?.task_id === task.id) {
        return await store.get('UPDATE task_sessions SET end_at = ? WHERE id = ? RETURNING *', now, active.id);
      }
      if (body.action === 'complete') {
        if (active?.task_id === task.id) await store.run('UPDATE task_sessions SET end_at = ? WHERE id = ?', now, active.id);
        return store.get('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *', now, task.id);
      }
      throw new RequestError('This work action is unavailable.', 409);
    });
  }

  return async function api(req, res, path) {
    const now = Date.now();
    let actor = await authenticatedEmployee(db, req, now, bearer);
    if (actor?.is_admin && adminAuth && !await adminAuth.identity(db, actor.id)) actor = null;
    if (req.method === 'GET' && path === '/api/session') return { actor };
    if (req.method === 'GET' && path === '/api/state') {
      if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
      return overview(actor, now);
    }
    if (req.method !== 'POST') throw new RequestError('Route not found.', 404);
    const body = await readBody(req, siteOrigin);
    if (path === '/api/login') return signIn(req, res, body, now);
    if (path === '/api/logout') return endSession(db, req, res, sessionOptions);
    if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
    if (path === '/api/attendance') {
      return recordAttendance(actor.id, body, now);
    }
    if (path === '/api/task-action') return taskAction(body, actor, now);
    if (path === '/api/work-requests') return submitRequest(body, actor, now);
    if (path === '/api/reminders/read') {
      await db.run('UPDATE reminders SET read_at = ? WHERE employee_id = ? AND read_at IS NULL', now, actor.id);
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
        ? await db.get('UPDATE expenses SET name = ?, category = ?, amount_paise = ?, spent_on = ?, note = ? WHERE id = ? RETURNING *', ...values, idValue(body.id))
        : await db.get('INSERT INTO expenses (name, category, amount_paise, spent_on, note) VALUES (?, ?, ?, ?, ?) RETURNING *', ...values);
      if (!entry) throw new RequestError('Expense not found.', 404);
      return entry;
    }
    if (path === '/api/office') {
      const name = text(body.name, 'office name');
      const site = await siteFrom(body);
      return await db.get(`
        INSERT INTO office (id, name, latitude, longitude, maps_url) VALUES (1, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude,
          longitude = excluded.longitude, maps_url = excluded.maps_url
        RETURNING name, latitude, longitude, maps_url
      `, name, site.latitude, site.longitude, site.maps_url);
    }
    throw new RequestError('Route not found.', 404);
  };
}
