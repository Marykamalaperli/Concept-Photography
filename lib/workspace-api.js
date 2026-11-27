import { createHash } from 'node:crypto';
import { authenticatedEmployee, createSession, endSession, hashPassword, passwordMatches, sessionFields } from './accounts.js';
import { mapsLocation } from './maps.js';
import { additionalShootLocations, attendanceTransition, maxAdditionalShootSites, shootSites } from './attendance-policy.js';
import { refreshReminders } from './reminders.js';
import { createHr } from './hr.js';
import { validDay } from './hr-policy.js';

const publicEmployee = `${sessionFields.join(', ')}, password_hash IS NOT NULL AS has_login`;
const signInFields = `${sessionFields.join(', ')}, password_hash`;
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

function paymentDueDate(value) {
  if (value === '' || value === null) return null;
  if (!validDay(value)) throw new RequestError('Choose a valid payment due date.');
  return value;
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
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for await (const part of req) {
      size += part.byteLength;
      if (size > 32000) throw new RequestError('Request is too large.', 413);
      text += decoder.decode(part, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch (error) {
    if (error instanceof RequestError) throw error;
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

async function additionalSitesFrom(value) {
  if (!Array.isArray(value) || value.length > maxAdditionalShootSites) {
    throw new RequestError(`A shoot can have up to ${maxAdditionalShootSites + 1} locations.`);
  }
  return Promise.all(value.map(async (entry, index) => {
    try {
      if (!entry || typeof entry !== 'object') throw new RequestError('Enter a Google Maps link.');
      const name = optional(entry.name, 'location name', 100);
      const mapsUrl = optional(entry.mapsUrl, 'Google Maps link', 2048);
      return { name, ...await siteFrom({ ...entry, mapsUrl }) };
    } catch (error) {
      throw new RequestError(`Location ${index + 2} · ${error.message}`);
    }
  }));
}

const coordinateKey = ({ latitude, longitude }) => `${latitude},${longitude}`;

export function createApi(db, { secureCookies = false, mobilePush, calendar, siteOrigin } = {}) {
  const sessionOptions = { secureCookies };

  async function throttle(req, now) {
    const address = req.clientAddress ?? req.socket.remoteAddress;
    const key = createHash('sha256').update(address ?? 'unknown').digest('hex');
    const limit = await db.transaction(async (store) => {
      await store.run('DELETE FROM login_limits WHERE reset_at <= ?', now);
      return store.get(`
        INSERT INTO login_limits (key, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT (key) DO UPDATE SET count = MIN(login_limits.count + 1, 13)
        RETURNING count
      `, key, now + 5 * 60_000);
    });
    if (limit.count > 12) throw new RequestError('Too many sign-in attempts. Try again in a few minutes.', 429);
    return key;
  }

  function idValue(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
  }

  const hr = createHr(db, { RequestError, idValue, text, optional, paise });

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
    const assignment = await store.get('SELECT 1 FROM task_assignments WHERE task_id = ? AND employee_id = ?', task.id, actor.id);
    if (!assignment) throw new RequestError('This work has not been assigned to your account.', 403);
    return task;
  }

  async function officeSite(store = db) {
    return (await store.get('SELECT name, latitude, longitude, maps_url FROM office WHERE id = 1')) ?? null;
  }

  async function overview(actor, now) {
    await db.transaction((store) => refreshReminders(store, now));
    const manager = actor.is_admin;
    const own = manager ? [] : [actor.id];
    const employeesQuery = manager
      ? db.all(`SELECT ${publicEmployee} FROM employees WHERE archived = 0 ORDER BY name`)
      : getEmployee(actor.id).then((person) => [person]);
    const adminQuery = manager ? Promise.all([
      db.all('SELECT * FROM clients ORDER BY name'),
      calendar && calendar.employees(db),
      db.all('SELECT * FROM payments ORDER BY paid_on DESC, id DESC'),
      db.all('SELECT * FROM expenses ORDER BY spent_on DESC, id DESC'),
    ]).then(([clients, calendarFeeds, payments, expenses]) => ({
      clients, ...(calendar ? { calendarFeeds } : {}), payments, expenses,
    })) : {};
    const [employees, tasks, crew, attendance, sessions, requests, openWork, office, hrState, reminders, admin] = await Promise.all([
      employeesQuery,
      db.all(`
        SELECT tasks.id, title, employee_id, start_at, estimate, location, category, completed_at,
          site_latitude, site_longitude, maps_url, additional_sites, priority, is_open, shoot_status, blocked_reason, clients.name AS client_name, clients.phone AS client_phone,
          parent_shoot_id, delivery_due_at, (SELECT source.title FROM tasks source WHERE source.id = tasks.parent_shoot_id) AS source_shoot_title
          ${manager ? ', client_id, income_paise, payment_due_on' : ''}
        FROM tasks JOIN employees ON employees.id = tasks.employee_id LEFT JOIN clients ON clients.id = tasks.client_id
        WHERE employees.archived = 0 ${manager ? '' : 'AND EXISTS (SELECT 1 FROM task_assignments WHERE task_id = tasks.id AND employee_id = ?)'}
        ORDER BY completed_at IS NOT NULL, priority DESC, start_at, tasks.id
      `, ...own),
      db.all(`
        SELECT task_assignments.task_id, task_assignments.employee_id, employees.name
        FROM task_assignments JOIN employees ON employees.id = task_assignments.employee_id
        JOIN tasks ON tasks.id = task_assignments.task_id
        WHERE employees.archived = 0 AND tasks.category = 'Photo shoot'
        ${manager ? '' : 'AND EXISTS (SELECT 1 FROM task_assignments mine WHERE mine.task_id = tasks.id AND mine.employee_id = ?)'}
        ORDER BY employees.name
      `, ...own),
      db.all(`
        SELECT attendance.* FROM attendance JOIN employees ON employees.id = attendance.employee_id
        WHERE employees.archived = 0 ${manager ? '' : 'AND employee_id = ?'}
        ORDER BY clock_in DESC, attendance.id DESC
      `, ...own),
      db.all(`
        SELECT task_sessions.* FROM task_sessions JOIN employees ON employees.id = task_sessions.employee_id
        WHERE employees.archived = 0 ${manager ? '' : 'AND employee_id = ?'}
        ORDER BY start_at DESC
      `, ...own),
      db.all(`
        SELECT work_requests.*, tasks.title FROM work_requests
        JOIN tasks ON tasks.id = work_requests.task_id
        JOIN employees ON employees.id = work_requests.employee_id
        WHERE employees.archived = 0 ${manager ? '' : 'AND work_requests.employee_id = ?'}
        ORDER BY status != 'pending', requested_at DESC
      `, ...own),
      manager ? [] : db.all(`
        SELECT id, title, start_at, estimate, category FROM tasks
        WHERE is_open = 1 AND completed_at IS NULL AND shoot_status = 'booked' AND start_at + estimate * 60000 > ?
        ORDER BY start_at
      `, now),
      officeSite(),
      hr.snapshot(actor),
      db.all(`
        SELECT reminders.*, tasks.title, tasks.start_at FROM reminders JOIN tasks ON tasks.id = reminders.task_id
        JOIN task_assignments ON task_assignments.task_id = tasks.id AND task_assignments.employee_id = reminders.employee_id
        WHERE reminders.employee_id = ? AND tasks.shoot_status = 'booked' ORDER BY sent_at DESC
      `, actor.id),
      adminQuery,
    ]);

    const crewByTask = new Map();
    for (const { task_id, ...member } of crew) {
      if (!crewByTask.has(task_id)) crewByTask.set(task_id, []);
      crewByTask.get(task_id).push(member);
    }
    for (const task of tasks) {
      if (task.category === 'Photo shoot') task.crew = crewByTask.get(task.id) ?? [];
    }
    return { actor, office, employees, tasks, attendance, sessions, requests, openWork, ...hrState, reminders, ...admin };
  }

  async function signIn(req, res, body, now) {
    const loginKey = await throttle(req, now);
    const address = email(body.email);
    const invalidCredentials = () => new RequestError('Invalid email or password.', 401);
    if (typeof body.password !== 'string' || body.password.length > 128) throw invalidCredentials();

    const person = await db.get(`SELECT ${signInFields} FROM employees WHERE email = ? AND archived = 0`, address);
    if (!await passwordMatches(body.password, person?.password_hash)) throw invalidCredentials();
    // Recheck in case the employee's credentials changed during verification.
    return db.transaction(async (store) => {
      const current = await store.get(`SELECT ${signInFields} FROM employees WHERE id = ? AND archived = 0`, person.id);
      if (!current || current.email !== address || current.password_hash !== person.password_hash || current.is_admin !== person.is_admin) {
        throw invalidCredentials();
      }
      await store.run('DELETE FROM login_limits WHERE key = ?', loginKey);
      return createSession(store, current, now, res, sessionOptions);
    });
  }

  async function saveEmployee(body) {
    const existing = body.id ? await getEmployee(body.id) : null;
    if (existing?.is_admin) throw new RequestError('The admin account is managed separately.');
    const name = text(body.name, 'name');
    const role = text(body.role, 'job role');
    const address = email(body.email);
    const mobile = body.phone ? phone(body.phone) : null;
    const startDate = Object.hasOwn(body, 'employmentStart') ? body.employmentStart || null : existing?.employment_start ?? null;
    if (startDate !== null && !validDay(startDate)) throw new RequestError('Enter a valid employment start date.');
    const hash = body.password || !existing?.has_login ? await hashPassword(password(body.password)) : null;
    return db.transaction(async (store) => {
      const duplicate = await store.get('SELECT id FROM employees WHERE email = ?', address);
      if (duplicate && duplicate.id !== existing?.id) throw new RequestError('That email is already in use.', 409);
      if (existing) {
        const updated = await store.get(`
          UPDATE employees SET name = ?, role = ?, email = ?, phone = ?, employment_start = ?, password_hash = COALESCE(?, password_hash)
          WHERE id = ? RETURNING ${publicEmployee}
        `, name, role, address, mobile, startDate, hash, existing.id);
        if (hash || address !== existing.email) await store.run('DELETE FROM auth_sessions WHERE employee_id = ?', existing.id);
        return updated;
      }
      const { total: count } = await store.get('SELECT COUNT(*) AS total FROM employees WHERE archived = 0');
      return await store.get(`
        INSERT INTO employees (name, role, email, phone, employment_start, color, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING ${publicEmployee}
      `, name, role, address, mobile, startDate, colors[count % colors.length], hash);
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

  async function checkScheduleConflicts(store, { employeeIds, startAt, endAt, taskId = 0, acknowledged }) {
    const selected = employeeIds.map(() => '?').join(', ');
    const [bookings, leave] = await Promise.all([
      store.all(`
        SELECT tasks.id, tasks.title, tasks.start_at, tasks.start_at + tasks.estimate * 60000 AS end_at,
          task_assignments.employee_id, employees.name
        FROM task_assignments JOIN tasks ON tasks.id = task_assignments.task_id
        JOIN employees ON employees.id = task_assignments.employee_id
        WHERE task_assignments.employee_id IN (${selected}) AND tasks.id <> ? AND tasks.shoot_status = 'booked'
          AND tasks.completed_at IS NULL AND tasks.start_at < ? AND tasks.start_at + tasks.estimate * 60000 > ?
        ORDER BY tasks.start_at, tasks.id, employees.name
      `, ...employeeIds, taskId, endAt, startAt),
      store.all(`
        SELECT hr_requests.id, hr_requests.employee_id, employees.name, day_from, day_to, leave_type
        FROM hr_requests JOIN employees ON employees.id = hr_requests.employee_id
        WHERE hr_requests.employee_id IN (${selected}) AND kind = 'leave' AND status = 'approved'
          AND day_from <= ? AND day_to >= ?
        ORDER BY day_from, hr_requests.id
      `, ...employeeIds, studioDate.format(endAt - 1), studioDate.format(startAt)),
    ]);
    const conflicts = [
      ...bookings.map((entry) => ({ ...entry, key: `work:${entry.employee_id}:${entry.id}:${entry.start_at}:${entry.end_at}` })),
      ...leave.map((entry) => ({ ...entry, key: `leave:${entry.id}:${entry.day_from}:${entry.day_to}:${entry.leave_type}` })),
    ];
    const accepted = new Set(Array.isArray(acknowledged) ? acknowledged : []);
    if (conflicts.some((item) => !accepted.has(item.key))) {
      const error = new RequestError('Review the scheduling conflicts before saving.', 409);
      error.conflicts = conflicts;
      throw error;
    }
  }

  async function saveTask(body, actor, now) {
    const title = text(body.title, 'work title');
    const location = text(body.location, 'location name');
    const category = text(body.category, 'work category');
    if (!categories.includes(category)) throw new RequestError('Choose a valid work category.');
    const startAt = Date.parse(body.startAt);
    if (!Number.isFinite(startAt)) throw new RequestError('Choose a valid start date and time.');
    const isShoot = category === 'Photo shoot';
    const hasEnd = (isShoot || category === 'Editing') && Object.hasOwn(body, 'endAt');
    const endAt = hasEnd ? Date.parse(body.endAt) : null;
    if (hasEnd && (!Number.isFinite(endAt) || endAt <= startAt)) {
      throw new RequestError('Choose an end date and time after the start.');
    }
    const estimate = hasEnd ? (endAt - startAt) / 60_000 : Number(body.estimate);
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 1440) {
      throw new RequestError(hasEnd ? 'Schedule the work for at least one minute and up to 24 hours.' : 'Enter a duration from 1 to 1,440 minutes.');
    }
    if (!actor.is_admin && (isShoot || body.id)) throw new RequestError('You can add individual tasks to your own board.', 403);
    const isOpen = actor.is_admin && body.assignment === 'open';

    const [site, submittedSites] = isShoot ? await Promise.all([
      siteFrom(body),
      Object.hasOwn(body, 'additionalSites') ? additionalSitesFrom(body.additionalSites) : null,
    ]) : [null, null];
    const income = isShoot ? paise(body.income, true) : 0;
    return db.transaction(async (store) => {
      const current = body.id ? await getTask(body.id, store) : null;
      const completed = current?.completed_at != null;
      if (current && current.category !== category) throw new RequestError('Keep the original work category when editing.');
      if (completed && !isShoot) throw new RequestError('Completed tasks cannot be rescheduled.', 409);
      const parentShootId = current?.parent_shoot_id ?? (body.parentShootId ? idValue(body.parentShootId) : null);
      let deliveryDueAt = null;
      if (parentShootId || body.parentShootId) {
        adminOnly(actor);
        if (!parentShootId || isOpen || category !== 'Editing' || (current && current.parent_shoot_id !== parentShootId)) {
          throw new RequestError('Editing must be assigned directly from a completed shoot.');
        }
        const shoot = await getTask(parentShootId, store);
        if (shoot.category !== 'Photo shoot' || !shoot.completed_at) throw new RequestError('Mark the shoot done before scheduling editing.', 409);
        if (!current && await store.get('SELECT id FROM tasks WHERE parent_shoot_id = ?', parentShootId)) {
          throw new RequestError('Editing is already scheduled for this shoot. Open its existing schedule.', 409);
        }
        deliveryDueAt = Date.parse(body.deliveryDueAt);
        if (!Number.isFinite(deliveryDueAt) || deliveryDueAt < startAt + estimate * 60_000) {
          throw new RequestError('Set a delivery deadline at or after the editing end time.');
        }
      }
      const employee = await getEmployee(isOpen || !actor.is_admin ? actor.id : body.employeeId, store);
      if (!completed && !isOpen && !employee.has_login && !employee.is_admin) throw new RequestError('Set up this employee’s login before assigning work.');
      const storedCrew = current && isShoot
        ? (await store.all('SELECT employee_id FROM shoot_crew WHERE task_id = ? ORDER BY employee_id', current.id)).map((member) => member.employee_id)
        : [];
      const selectedCrew = isShoot && !isOpen ? body.crew ?? storedCrew : [];
      if (!Array.isArray(selectedCrew) || selectedCrew.length > 50 || selectedCrew.some((id) => !idValue(id))) {
        throw new RequestError('Choose up to 50 valid additional crew members.');
      }
      const crew = [...new Set(selectedCrew.map(idValue))].filter((id) => id !== employee.id).sort((a, b) => a - b);
      const crewChanged = crew.join() !== storedCrew.join();
      if (completed && (isOpen || employee.id !== current.employee_id || crewChanged)) {
        throw new RequestError('The lead and crew are fixed once the shoot is complete.', 409);
      }
      if (crewChanged) {
        for (const id of crew) {
          const member = await getEmployee(id, store);
          if (!member.has_login && !member.is_admin) throw new RequestError('Set up each crew member’s login before assigning a shoot.');
        }
      }
      const additionalSites = submittedSites ?? additionalShootLocations(current);
      const newPins = isShoot ? [site, ...additionalSites].map(coordinateKey).sort() : [];
      if (new Set(newPins).size !== newPins.length) throw new RequestError('Use a different Google Maps pin for each shoot location.');
      const siteChanged = current && isShoot && shootSites(current).map(coordinateKey).sort().join('|') !== newPins.join('|');
      if (current) {
        const hasTime = await store.get('SELECT 1 FROM task_sessions WHERE task_id = ?', current.id);
        if (hasTime && (isOpen || employee.id !== current.employee_id || crewChanged)) throw new RequestError('Work with recorded time cannot be reassigned.', 409);
        if (hasTime && !completed && siteChanged) {
          throw new RequestError('The site cannot change after work time has been recorded.', 409);
        }
        const { total: paid } = await store.get('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE task_id = ?', current.id);
        if (income < paid) throw new RequestError('Shoot income cannot be lower than payments already received.');
      }
      const clientId = isShoot ? await clientForTask(body, store) : null;
      const status = isShoot && body.shootStatus ? body.shootStatus : current?.shoot_status ?? 'booked';
      if (!['booked', 'postponed', 'cancelled'].includes(status)) throw new RequestError('Choose a valid booking status.');
      if (completed && status !== current.shoot_status) throw new RequestError('Completed shoots must keep their Done status.', 409);
      const scheduleChanged = !current || current.start_at !== startAt || current.estimate !== estimate ||
        current.employee_id !== employee.id || crewChanged || current.is_open || current.shoot_status !== status;
      if (actor.is_admin && (isShoot || parentShootId) && !isOpen && !completed && status === 'booked' && scheduleChanged) {
        await checkScheduleConflicts(store, { employeeIds: [employee.id, ...crew], startAt, endAt: startAt + estimate * 60_000,
          taskId: current?.id, acknowledged: body.acknowledgedConflicts });
      }
      if (current && isShoot && (status !== current.shoot_status || siteChanged || current.start_at !== startAt || current.estimate !== estimate)) {
        await ensureShootInactive(store, current);
      }
      const dueOn = isShoot && Object.hasOwn(body, 'paymentDueOn') ? paymentDueDate(body.paymentDueOn) : current?.payment_due_on ?? null;
      const values = [title, employee.id, startAt, estimate, location, category, site?.latitude ?? null,
        site?.longitude ?? null, site?.maps_url ?? null, clientId, income, Number(actor.is_admin && !isOpen), Number(isOpen), status,
        parentShootId, deliveryDueAt, dueOn, JSON.stringify(additionalSites)];
      let task;
      if (current) {
        task = await store.get(`
          UPDATE tasks SET title = ?, employee_id = ?, start_at = ?, estimate = ?, location = ?, category = ?,
            site_latitude = ?, site_longitude = ?, maps_url = ?, client_id = ?, income_paise = ?, priority = ?, is_open = ?, shoot_status = ?,
            parent_shoot_id = ?, delivery_due_at = ?, payment_due_on = ?, additional_sites = ?
          WHERE id = ? RETURNING *
        `, ...values, current.id);
        if (!completed && (current.start_at !== startAt || current.employee_id !== employee.id || isOpen || status !== current.shoot_status)) {
          await store.run('DELETE FROM reminders WHERE task_id = ?', task.id);
        }
        if (!isOpen) await store.run("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND status = 'pending'", now, task.id);
      } else {
        task = await store.get(`
          INSERT INTO tasks (title, employee_id, start_at, estimate, location, category, site_latitude,
            site_longitude, maps_url, client_id, income_paise, priority, is_open, shoot_status, parent_shoot_id, delivery_due_at, payment_due_on, additional_sites)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
        `, ...values);
      }
      if (crewChanged) {
        await store.run('DELETE FROM shoot_crew WHERE task_id = ?', task.id);
        for (const id of crew) await store.run('INSERT INTO shoot_crew (task_id, employee_id) VALUES (?, ?)', task.id, id);
        await store.run(`DELETE FROM reminders WHERE task_id = ?
          AND NOT EXISTS (SELECT 1 FROM task_assignments WHERE task_id = reminders.task_id AND employee_id = reminders.employee_id)`, task.id);
      }
      await refreshReminders(store, now);
      return task;
    });
  }

  function submitRequest(body, actor, now) {
    if (actor.is_admin) throw new RequestError('Admins can assign work from the schedule.', 403);
    return db.transaction(async (store) => {
      const task = await getTask(body.taskId, store);
      if (!task.is_open || task.shoot_status !== 'booked' || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
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
        if (!task.is_open || task.shoot_status !== 'booked' || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
        await getEmployee(request.employee_id, store);
        if (task.category === 'Photo shoot') {
          await checkScheduleConflicts(store, { employeeIds: [request.employee_id], startAt: task.start_at,
            endAt: task.start_at + task.estimate * 60_000, taskId: task.id, acknowledged: body.acknowledgedConflicts });
        }
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
      if (!existing && task.shoot_status === 'cancelled') throw new RequestError('Rebook the shoot before recording another payment.', 409);
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
      const tasks = await store.all(`
        SELECT tasks.* FROM tasks JOIN task_assignments ON tasks.id = task_assignments.task_id
        WHERE task_assignments.employee_id = ? AND category = 'Photo shoot'
      `, employeeId);
      const eligible = tasks.map((task) => ({ ...task, crew: [{ employee_id: employeeId }] }));
      const change = attendanceTransition({ command, latest, office: await officeSite(store), tasks: eligible, employeeId, now });
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
      if (task.completed_at || task.shoot_status !== 'booked') throw new RequestError('This work is closed.', 409);
      const active = await store.get('SELECT * FROM task_sessions WHERE employee_id = ? AND end_at IS NULL', actor.id);
      if (body.action === 'block' || body.action === 'unblock') {
        if (task.category === 'Photo shoot') throw new RequestError('Shoot status is managed in the calendar.');
        const reason = body.action === 'block' ? text(body.reason, 'reason for blocking', 400) : null;
        if (reason && active?.task_id === task.id) await store.run('UPDATE task_sessions SET end_at = ? WHERE id = ?', now, active.id);
        return store.get('UPDATE tasks SET blocked_reason = ? WHERE id = ? RETURNING *', reason, task.id);
      }
      if (task.blocked_reason) throw new RequestError('Unblock this task before working on it.', 409);
      if (body.action === 'start' || (body.action === 'complete' && task.category === 'Photo shoot')) {
        if (task.category === 'Photo shoot') {
          const current = await store.get('SELECT site FROM attendance WHERE employee_id = ? AND clock_out IS NULL', actor.id);
          if (!shootSites(task).length || !current?.site || JSON.parse(current.site).taskId !== task.id) {
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
        if (task.category === 'Photo shoot' && await store.get('SELECT 1 FROM shoot_crew WHERE task_id = ?', task.id)) {
          throw new RequestError('The admin marks crew shoots done after the team checks out.', 409);
        }
        if (active?.task_id === task.id) await store.run('UPDATE task_sessions SET end_at = ? WHERE id = ?', now, active.id);
        return store.get('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *', now, task.id);
      }
      throw new RequestError('This work action is unavailable.', 409);
    });
  }

  async function ensureShootInactive(store, task) {
    const activeShifts = await store.all(`
      SELECT site FROM attendance WHERE clock_out IS NULL AND
        (employee_id = ? OR EXISTS (SELECT 1 FROM shoot_crew WHERE task_id = ? AND employee_id = attendance.employee_id))
    `, task.employee_id, task.id);
    const activeTask = await store.get('SELECT 1 FROM task_sessions WHERE task_id = ? AND end_at IS NULL', task.id);
    if (activeTask || (activeShifts.some(({ site }) => site && JSON.parse(site).taskId === task.id))) {
      throw new RequestError('Everyone must clock out of the shoot before its booking can change.', 409);
    }
  }

  function finishShoot(body, now) {
    return db.transaction(async (store) => {
      const shoot = await getTask(body.taskId, store);
      if (shoot.category !== 'Photo shoot' || shoot.completed_at || shoot.is_open || shoot.shoot_status !== 'booked') {
        throw new RequestError('Only a booked, assigned shoot can be marked done.', 409);
      }
      await ensureShootInactive(store, shoot);
      return store.get('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *', now, shoot.id);
    });
  }

  return async function api(req, res, path) {
    const now = Date.now();
    if (req.method === 'POST' && path === '/api/login') return signIn(req, res, await readBody(req, siteOrigin), now);
    const actor = await authenticatedEmployee(db, req, now);
    if (req.method === 'GET' && path === '/api/session') return { actor };
    if (req.method === 'GET' && path === '/api/push/key' && mobilePush) {
      if (!actor) throw new RequestError('Sign in to enable mobile alerts.', 401);
      return mobilePush.key(db);
    }
    if (req.method === 'GET' && path === '/api/calendar' && calendar) {
      if (!actor) throw new RequestError('Sign in to connect your calendar.', 401);
      return calendar.status(db, actor.id);
    }
    if (req.method === 'GET' && path === '/api/state') {
      if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
      return overview(actor, now);
    }
    if (req.method !== 'POST') throw new RequestError('Route not found.', 404);
    const body = await readBody(req, siteOrigin);
    if (path === '/api/logout') {
      if (actor && mobilePush && body.pushEndpoint) await mobilePush.remove(db, actor.id, body.pushEndpoint);
      return endSession(db, req, res, sessionOptions);
    }
    if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
    if (calendar) {
      if (path === '/api/calendar/issue') return calendar.issue(db, actor);
      if (path === '/api/calendar/revoke') return calendar.revoke(db, actor.id);
    }
    if (mobilePush) {
      if (path === '/api/push/status') return mobilePush.status(db, actor.id, body.endpoint);
      if (path === '/api/push/register') return mobilePush.register(db, actor.id, body);
      if (path === '/api/push/remove') return mobilePush.remove(db, actor.id, body.endpoint);
      if (path === '/api/push/test') return mobilePush.testDevice(db, actor.id, body.endpoint);
    }
    if (path === '/api/attendance') {
      return recordAttendance(actor.id, body, now);
    }
    if (path === '/api/task-action') return taskAction(body, actor, now);
    if (path === '/api/work-requests') return submitRequest(body, actor, now);
    if (path === '/api/reminders/read') {
      await db.run('UPDATE reminders SET read_at = ? WHERE employee_id = ? AND read_at IS NULL', now, actor.id);
      return { ok: true };
    }
    if (path === '/api/hr/requests') return hr.submit(body, actor, now);
    if (path === '/api/hr/review') return hr.review(body, actor, now);
    if (path === '/api/hr/work-logs') return hr.log(body, actor, now);
    if (path === '/api/tasks') return saveTask(body, actor, now);
    adminOnly(actor);
    if (path.startsWith('/api/hr/')) return hr.manage(path, body, now);
    if (path === '/api/shoot-done') return finishShoot(body, now);
    if (path === '/api/employees') return saveEmployee(body);
    if (path === '/api/clients') return saveClient(body);
    if (path === '/api/request-decisions') return decideRequest(body, now);
    if (path === '/api/payments') return recordPayment(body, now);
    if (path === '/api/payment-due') {
      const date = paymentDueDate(body.paymentDueOn);
      return db.transaction(async (store) => {
        const shoot = await getTask(body.taskId, store);
        if (shoot.category !== 'Photo shoot') throw new RequestError('Shoot not found.', 404);
        return store.get('UPDATE tasks SET payment_due_on = ? WHERE id = ? RETURNING id, payment_due_on', date, shoot.id);
      });
    }
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
