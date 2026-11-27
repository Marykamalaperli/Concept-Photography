import { searchAudit } from './audit-history.js';
import { settingsAt } from './business-settings.js';
import { setProfilePhoto } from './profile-photos.js';
import { canManage, inScope, roleAllows } from './scoped-access.js';
import { createOfflineAttendance } from './offline-attendance.js';
import { createOfflineWork } from './offline-work.js';
import { createDelegation } from './delegation.js';
import { createProjects } from './projects.js';
import { createRevenue } from './revenue.js';
import { createFootage } from './footage.js';
import { isFileIdentifier } from './local-files.js';
import { createAttendanceWorkflows } from './attendance-workflows.js';
import { createOperations, displaceEmergencyWork } from './operations.js';
import { nextWorkingDay, notify, notifyAdmins, recordBusinessAudit } from './studio-notices.js';
import { createHash } from 'node:crypto';
import { authenticatedEmployee, createSession, endSession, hashPassword, passwordMatches, sessionFields } from './accounts.js';
import { mapsLocation } from './maps.js';
import { additionalShootLocations, attendanceTransition, boundarySampleAge, maxAdditionalShootSites, shootSites } from './attendance-policy.js';
import { endAttendanceGap } from './attendance-gaps.js';
import { refreshReminders } from './reminders.js';
import { createHr } from './hr.js';
import { studioDay, validDay } from './hr-policy.js';

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
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new RequestError('Submit this request from the workspace.', 403);
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
    throw new RequestError(`An office or shoot booking can have up to ${maxAdditionalShootSites + 1} locations.`);
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
const audit = (db, actorId, subjectId, action, now) =>
  db.run('INSERT INTO access_audit (actor_id, subject_id, action, occurred_at) VALUES (?, ?, ?, ?)', actorId, subjectId, action, now);

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

  const hours = createAttendanceWorkflows(db, { RequestError, idValue, text, optional });
  const offlineAttendance = createOfflineAttendance(db, hours, { RequestError, idValue });
  const delegation = createDelegation(db, { RequestError, idValue });
  const projects = createProjects(db, { RequestError, idValue, text, optional });
  const revenue = createRevenue(db, { RequestError, idValue, paise });
  const footage = createFootage(db, { RequestError, idValue, text, optional });
  const operations = createOperations(db, { RequestError, idValue, text, optional });
  const hr = createHr(db, { RequestError, idValue, text, optional, paise });
  const offlineWork = createOfflineWork(db, operations, hr, { RequestError, idValue, optional });

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
    return (await store.get(`
      SELECT o.name, o.address, o.latitude, o.longitude, o.maps_url, o.additional_sites, h.office_radius_m AS radius, h.max_accuracy_m AS maxAccuracy
      FROM office o CROSS JOIN hr_settings h WHERE o.id = 1 AND h.id = 1
    `)) ?? null;
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
      db.all('SELECT employee_id, kind, start_at FROM work_periods WHERE end_at IS NULL'),
      nextPlanSummary(now),
    ]).then(([clients, calendarFeeds, payments, expenses, activeWorkPeriods, missingNextPlans]) => ({
      clients, ...(calendar ? { calendarFeeds } : {}), payments, expenses, activeWorkPeriods, missingNextPlans,
    })) : revenue.report({ date: studioDay(now), period: 'month' }, actor, now)
      .then(({ total, rows }) => ({ revenueSummary: { total, shoots: rows.length } }));
    const [employees, tasks, crew, attendance, sessions, requests, openWork, office, hrState, reminders, gaps, admin, operationState, workHours, footageState, projectList, taskDrafts] = await Promise.all([
      employeesQuery,
      db.all(`
        SELECT tasks.id, title, employee_id, start_at, estimate, location, tasks.category, completed_at,
          site_latitude, site_longitude, maps_url, additional_sites, priority, is_open, shoot_status, blocked_reason, clients.name AS client_name, clients.phone AS client_phone,
          (SELECT id FROM footage_checks WHERE task_id = tasks.id) AS footage_id,
          (SELECT status FROM footage_checks WHERE shoot_id = tasks.id) AS footage_status,
          COALESCE(project_id, (SELECT linked.project_id FROM tasks linked WHERE linked.id = tasks.parent_shoot_id)) AS project_id,
          parent_shoot_id, delivery_due_at, daily_plan_id, work_state, work_revision, acknowledged_at, completion_report, completion_file_id, evidence_required, is_unscheduled, emergency, (SELECT source.title FROM tasks source WHERE source.id = tasks.parent_shoot_id) AS source_shoot_title
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
      hr.snapshot(actor, now),
      db.all(`
        SELECT reminders.*, tasks.title, tasks.start_at FROM reminders JOIN tasks ON tasks.id = reminders.task_id
        JOIN task_assignments ON task_assignments.task_id = tasks.id AND task_assignments.employee_id = reminders.employee_id
        WHERE reminders.employee_id = ? AND tasks.shoot_status = 'booked' ORDER BY sent_at DESC
      `, actor.id),
      db.all(`
        SELECT attendance_gaps.*, attendance.employee_id FROM attendance_gaps
        JOIN attendance ON attendance.id = attendance_gaps.attendance_id
        ${manager ? '' : 'WHERE attendance.employee_id = ?'}
        ORDER BY attendance_gaps.start_at DESC
      `, ...own),
      adminQuery, operations.snapshot(actor), hours.snapshot(actor), footage.snapshot(actor), projects.listed(actor), offlineWork.drafts(actor),
    ]);

    const crewByTask = new Map();
    for (const { task_id, ...member } of crew) {
      if (!crewByTask.has(task_id)) crewByTask.set(task_id, []);
      crewByTask.get(task_id).push(member);
    }
    for (const task of tasks) {
      if (task.category === 'Photo shoot') task.crew = crewByTask.get(task.id) ?? [];
    }
    return { actor, office, employees, tasks, attendance, sessions, requests, openWork, ...hrState, reminders, attendanceGaps: gaps, ...admin, ...operationState, ...workHours, ...footageState, projects: projectList, taskDrafts };
  }

  async function nextPlanSummary(now) {
    const date = studioDay(now);
    const settings = await settingsAt(db, date);
    if (now < Date.parse(date + 'T' + settings.plan_deadline + ':00+05:30') ||
        new Date(date + 'T12:00:00+05:30').getUTCDay() === settings.week_off) return 0;
    const [holidays, people, leave, plans] = await Promise.all([
      db.all('SELECT day FROM holidays WHERE day >= ?', date),
      db.all(`SELECT id FROM employees WHERE is_admin = 0 AND archived = 0 AND deactivated = 0
        AND password_hash IS NOT NULL AND (employment_start IS NULL OR employment_start <= ?)`, date),
      db.all(`SELECT employee_id, day_from, day_to, leave_type FROM hr_requests
        WHERE kind = 'leave' AND status = 'approved' AND leave_type != 'half' AND day_to >= ?`, date),
      db.all("SELECT employee_id, work_day FROM daily_plans WHERE work_day > ? AND status IN ('submitted', 'approved')", date),
    ]);
    const daysOff = new Set(holidays.map((holiday) => holiday.day));
    if (daysOff.has(date)) return 0;
    const received = new Set(plans.map((plan) => plan.employee_id + ':' + plan.work_day));
    return people.filter((person) => {
      const approved = leave.filter((item) => item.employee_id === person.id);
      if (approved.some((item) => item.day_from <= date)) return false;
      const next = nextWorkingDay(date, settings.week_off, daysOff, approved);
      return next && !received.has(person.id + ':' + next);
    }).length;
  }

  async function signIn(req, res, body, now) {
    const loginKey = await throttle(req, now);
    const address = email(body.email);
    const invalidCredentials = () => new RequestError('Invalid email or password.', 401);
    if (typeof body.password !== 'string' || body.password.length > 128) throw invalidCredentials();

    const person = await db.get(`SELECT ${signInFields} FROM employees WHERE email = ? AND archived = 0 AND deactivated = 0`, address);
    if (!await passwordMatches(body.password, person?.password_hash)) {
      await audit(db, null, person?.id ?? null, 'Sign-in failed', now);
      throw invalidCredentials();
    }
    // Recheck in case the employee's credentials changed during verification.
    return db.transaction(async (store) => {
      const current = await store.get(`SELECT ${signInFields} FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0`, person.id);
      if (!current || current.email !== address || current.password_hash !== person.password_hash || current.is_admin !== person.is_admin) {
        throw invalidCredentials();
      }
      await store.run('DELETE FROM login_limits WHERE key = ?', loginKey);
      await audit(store, current.id, current.id, 'Signed in', now);
      return createSession(store, current, now, res, sessionOptions);
    });
  }

  async function saveEmployee(body, actor, now) {
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
        await audit(store, actor.id, existing.id, hash ? 'Password reset by administrator' : 'Employee profile edited', now);
        await recordBusinessAudit(store, actor.id, 'employee', existing.id, 'employee updated', now, {
          before: { name: existing.name, role: existing.role, employmentStart: existing.employment_start },
          after: { name, role, employmentStart: startDate },
          contactChanged: address !== existing.email || mobile !== existing.phone, passwordReset: Boolean(hash),
        });
        return updated;
      }
      const { total: count } = await store.get('SELECT COUNT(*) AS total FROM employees WHERE archived = 0');
      const employee = await store.get(`
        INSERT INTO employees (name, role, email, phone, employment_start, color, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING ${publicEmployee}
      `, name, role, address, mobile, startDate, colors[count % colors.length], hash);
      await audit(store, actor.id, employee.id, 'Employee created', now);
      return employee;
    });
  }

  function changeAccess(body, actor, now) {
    if (typeof body.active !== 'boolean') throw new RequestError('Choose whether to activate or deactivate this employee.');
    return db.transaction(async (store) => {
      const employee = await getEmployee(body.id, store);
      if (employee.is_admin) throw new RequestError('The administrator account is managed separately.', 403);
      if (Boolean(employee.deactivated) !== body.active) return employee;
      const changed = await store.get(`UPDATE employees SET deactivated = ? WHERE id = ? RETURNING ${publicEmployee}`,
        Number(!body.active), employee.id);
      if (!body.active) {
        await store.run('DELETE FROM auth_sessions WHERE employee_id = ?', employee.id);
        await store.run('DELETE FROM calendar_feeds WHERE employee_id = ?', employee.id);
        await store.run('DELETE FROM push_subscriptions WHERE employee_id = ?', employee.id);
        const shift = await store.get('SELECT id FROM attendance WHERE employee_id = ? AND clock_out IS NULL', employee.id);
        if (shift) await endAttendanceGap(store, shift.id, now);
        await store.run("UPDATE attendance SET clock_out = ?, out_reason = 'account-deactivated' WHERE employee_id = ? AND clock_out IS NULL", now, employee.id);
        const period = await store.get('SELECT * FROM work_periods WHERE employee_id = ? AND end_at IS NULL', employee.id);
        await hours.endPeriod(store, period, actor.id, now);
        await store.run('UPDATE attendance SET resume_pending = 0 WHERE employee_id = ? AND resume_pending = 1', employee.id);
        await store.run('UPDATE task_sessions SET end_at = ? WHERE employee_id = ? AND end_at IS NULL', now, employee.id);
      }
      await audit(store, actor.id, employee.id, body.active ? 'Employee activated' : 'Employee deactivated', now);
      return changed;
    });
  }

  async function changePassword(body, actor, now) {
    const next = password(body.password);
    const current = await db.get('SELECT password_hash FROM employees WHERE id = ? AND deactivated = 0', actor.id);
    if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 ||
        !await passwordMatches(body.currentPassword, current?.password_hash)) {
      throw new RequestError('Current password is incorrect.');
    }
    const hash = await hashPassword(next);
    await db.transaction(async (store) => {
      const changed = await store.get(`
        UPDATE employees SET password_hash = ? WHERE id = ? AND deactivated = 0 AND password_hash = ? RETURNING id
      `, hash, actor.id, current.password_hash);
      if (!changed) throw new RequestError('Credentials changed. Sign in again.', 409);
      await store.run('DELETE FROM auth_sessions WHERE employee_id = ?', actor.id);
      await store.run('DELETE FROM calendar_feeds WHERE employee_id = ?', actor.id);
      await store.run('DELETE FROM push_subscriptions WHERE employee_id = ?', actor.id);
      await audit(store, actor.id, actor.id, 'Password changed', now);
    });
    return { ok: true };
  }

  async function saveClient(body, actor, now) {
    const name = text(body.name, 'client name');
    const mobile = phone(body.phone);
    const address = optional(body.email, 'email', 254) ? email(body.email) : null;
    const notes = optional(body.notes, 'client notes', 1000);
    return db.transaction(async (store) => {
      const allowed = body.id
        ? await canManage(store, actor, 'edit-clients', 'client', idValue(body.id))
        : await roleAllows(store, actor, 'create-clients');
      if (!allowed) throw new RequestError('Client editing or creation is outside your access.', 403);
      const existing = await store.get('SELECT id FROM clients WHERE phone = ?', mobile);
      if (existing && existing.id !== idValue(body.id)) throw new RequestError('A client already uses that mobile number.', 409);
      const prior = body.id ? await store.get('SELECT * FROM clients WHERE id = ?', idValue(body.id)) : null;
      if (body.id && !prior) throw new RequestError('Client not found.', 404);
      const category = body.category === undefined ? prior?.category ?? null : optional(body.category, 'client category', 100);
      const postal = body.postalAddress === undefined ? prior?.postal_address ?? null : optional(body.postalAddress, 'postal address', 350);
      const client = prior
        ? await store.get('UPDATE clients SET name=?, phone=?, email=?, notes=?, category=?, postal_address=? WHERE id=? RETURNING *',
          name, mobile, address, notes, category, postal, prior.id)
        : await store.get('INSERT INTO clients(name,phone,email,notes,category,postal_address) VALUES (?,?,?,?,?,?) RETURNING *',
          name, mobile, address, notes, category, postal);
      if (!prior && !actor.is_admin) {
        await store.run('INSERT INTO client_staff(employee_id, client_id) VALUES(?,?)', actor.id, client.id);
        await store.run('UPDATE employees SET scope_revision = scope_revision + 1 WHERE id = ?', actor.id);
      }
      const changes = { before: prior ? { name: prior.name, category: prior.category } : null, after: { name: client.name, category: client.category },
        contactChanged: Boolean(prior && (prior.email !== client.email || prior.phone !== client.phone || prior.postal_address !== client.postal_address)),
        notesChanged: Boolean(prior && prior.notes !== client.notes) };
      await recordBusinessAudit(store, actor.id, 'client', client.id, prior ? 'client updated' : 'client added', now, changes);
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

  async function checkScheduleConflicts(store, { employeeIds, startAt, endAt, taskId = 0, acknowledged, redact = false }) {
    const selected = employeeIds.map(() => '?').join(', ');
    const [bookings, leave] = await Promise.all([
      store.all(`
        SELECT tasks.id, tasks.title, tasks.start_at, tasks.start_at + tasks.estimate * 60000 AS end_at,
          task_assignments.employee_id, employees.name
        FROM task_assignments JOIN tasks ON tasks.id = task_assignments.task_id
        JOIN employees ON employees.id = task_assignments.employee_id
        WHERE task_assignments.employee_id IN (${selected}) AND tasks.id <> ? AND tasks.shoot_status = 'booked'
          AND tasks.completed_at IS NULL AND tasks.work_state = 'ready' AND tasks.is_unscheduled = 0 AND tasks.start_at < ? AND tasks.start_at + tasks.estimate * 60000 > ?
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
    if (redact && (bookings.length || leave.length)) {
      throw new RequestError('A selected employee is unavailable at that time. Ask an administrator to review the conflict.', 409);
    }
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
    const unscheduled = body.unscheduled === true;
    const isShoot = category === 'Photo shoot';
    const isOpen = actor.is_admin && body.assignment === 'open';
    const delegated = !actor.is_admin && body.delegated === true;
    const editingWork = actor.is_admin || delegated;
    if (delegated && (Object.hasOwn(body, 'income') || Object.hasOwn(body, 'paymentDueOn') ||
        body.assignment === 'open' || body.emergency === true)) throw new RequestError('Only the administrator manages pricing, open bookings and emergencies.', 403);
    if (unscheduled && (!editingWork || isShoot || body.parentShootId || isOpen)) {
      throw new RequestError('Only administrators can assign non-shoot work without a start time.', 403);
    }
    const startAt = unscheduled ? now : Date.parse(body.startAt);
    if (!Number.isFinite(startAt)) throw new RequestError('Choose a valid start date and time.');
    const hasEnd = (isShoot || category === 'Editing') && Object.hasOwn(body, 'endAt');
    const endAt = hasEnd ? Date.parse(body.endAt) : null;
    if (hasEnd && (!Number.isFinite(endAt) || endAt <= startAt)) {
      throw new RequestError('Choose an end date and time after the start.');
    }
    const estimate = hasEnd ? (endAt - startAt) / 60_000 : Number(body.estimate);
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 1440) {
      throw new RequestError(hasEnd ? 'Schedule the work for at least one minute and up to 24 hours.' : 'Enter a duration from 1 to 1,440 minutes.');
    }
    if (!editingWork && (isShoot || body.id)) throw new RequestError('You can add individual tasks to your own board.', 403);

    const [site, submittedSites] = isShoot ? await Promise.all([
      siteFrom(body),
      Object.hasOwn(body, 'additionalSites') ? additionalSitesFrom(body.additionalSites) : null,
    ]) : [null, null];
    const initialIncome = isShoot && actor.is_admin ? paise(body.income, true) : 0;
    return db.transaction(async (store) => {
      if (!editingWork && await store.get(
        "SELECT 1 FROM daily_plans WHERE employee_id = ? AND work_day = ? AND status = 'approved'", actor.id, studioDate.format(startAt),
      )) throw new RequestError('Use an approved plan revision to add work to this date.', 409);
      const current = body.id ? await getTask(body.id, store) : null;
      const project = delegated ? idValue(body.projectId ?? current?.project_id) : null;
      if (delegated && (!await canManage(store, actor, isShoot ? 'schedule-shoots' : 'assign-tasks', 'project', project) ||
          (current && current.project_id !== project) || body.parentShootId || current?.parent_shoot_id || current?.is_open)) {
        throw new RequestError('This scheduling action is outside your project access.', 403);
      }
      const income = delegated ? current?.income_paise ?? 0 : initialIncome;
      const completed = current?.completed_at != null;
      if (current && unscheduled && !current.is_unscheduled) throw new RequestError('Request a schedule change for scheduled tasks.', 409);
      const recordedStart = current && unscheduled ? current.start_at : startAt;
      if (current && await store.get('SELECT 1 FROM footage_checks WHERE task_id = ?', current.id)) {
        throw new RequestError('Manage storage verification from Footage storage.', 409);
      }
      if (current?.daily_plan_id || (current && current.work_state !== 'ready')) {
        throw new RequestError('Use the approved task change workflow for this task.', 409);
      }
      const emergency = current?.emergency || Number(actor.is_admin && isShoot && !current && !isOpen && body.emergency === true);
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
      const employee = await getEmployee(isOpen || !editingWork ? actor.id : body.employeeId ?? current?.employee_id ?? actor.id, store);
      if (employee.deactivated && employee.id !== current?.employee_id) throw new RequestError('Choose an active employee.');
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
      if (delegated && isShoot && (crewChanged || employee.id !== (current?.employee_id ?? actor.id)) &&
          !await roleAllows(store, actor, 'assign-crew')) throw new RequestError('You do not have permission to assign shoot crew.', 403);
      if (completed && (isOpen || employee.id !== current.employee_id || crewChanged)) {
        throw new RequestError('The lead and crew are fixed once the shoot is complete.', 409);
      }
      if (crewChanged) {
        for (const id of crew) {
          const member = await getEmployee(id, store);
          if (member.deactivated && !storedCrew.includes(id)) throw new RequestError('Choose active staff for the shoot crew.');
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
        if (isShoot && current.income_paise !== income &&
            await store.get('SELECT 1 FROM revenue_allocations WHERE shoot_id = ?', current.id)) {
          throw new RequestError('Clear the employee allocations before changing this shoot’s value.', 409);
        }
      }
      const clientId = isShoot ? (delegated ? (await store.get('SELECT client_id FROM projects WHERE id = ?', project)).client_id :
        await clientForTask(body, store)) : null;
      const projectId = delegated ? project : isShoot ? (body.projectId === undefined ? current?.project_id ?? null : idValue(body.projectId)) : null;
      if (isShoot && (projectId != null || body.projectId) &&
          !await store.get('SELECT 1 FROM projects WHERE id = ? AND client_id = ?', projectId, clientId)) {
        throw new RequestError('Choose a project for the selected client.');
      }
      const status = isShoot && body.shootStatus ? body.shootStatus : current?.shoot_status ?? 'booked';
      if (!['booked', 'postponed', 'cancelled'].includes(status)) throw new RequestError('Choose a valid booking status.');
      if (completed && status !== current.shoot_status) throw new RequestError('Completed shoots must keep their Done status.', 409);
      const scheduleChanged = !current || current.start_at !== recordedStart || current.is_unscheduled !== Number(unscheduled) || current.estimate !== estimate ||
        current.employee_id !== employee.id || crewChanged || current.is_open || current.shoot_status !== status;
      if (editingWork && !unscheduled && (delegated || isShoot || parentShootId || current?.is_unscheduled) && !isOpen && !completed && status === 'booked' && scheduleChanged) {
        await checkScheduleConflicts(store, { employeeIds: [employee.id, ...crew], startAt, endAt: startAt + estimate * 60_000,
          taskId: current?.id, acknowledged: body.acknowledgedConflicts, redact: delegated });
      }
      if (current && isShoot && (status !== current.shoot_status || siteChanged || current.start_at !== startAt || current.estimate !== estimate)) {
        await ensureShootInactive(store, current);
      }
      const dueOn = isShoot && Object.hasOwn(body, 'paymentDueOn') ? paymentDueDate(body.paymentDueOn) : current?.payment_due_on ?? null;
      const values = [title, employee.id, recordedStart, estimate, location, category, site?.latitude ?? null,
        site?.longitude ?? null, site?.maps_url ?? null, clientId, income, Number(editingWork && !isOpen), Number(isOpen), status,
        parentShootId, deliveryDueAt, dueOn, JSON.stringify(additionalSites), emergency, projectId, Number(unscheduled)];
      let task;
      if (current) {
        task = await store.get(`
          UPDATE tasks SET title = ?, employee_id = ?, start_at = ?, estimate = ?, location = ?, category = ?,
            site_latitude = ?, site_longitude = ?, maps_url = ?, client_id = ?, income_paise = ?, priority = ?, is_open = ?, shoot_status = ?,
            parent_shoot_id = ?, delivery_due_at = ?, payment_due_on = ?, additional_sites = ?, emergency = ?, project_id = ?, is_unscheduled = ?
          WHERE id = ? RETURNING *
        `, ...values, current.id);
        if (!completed && (current.start_at !== recordedStart || current.is_unscheduled !== Number(unscheduled) || current.employee_id !== employee.id || isOpen || status !== current.shoot_status)) {
          await store.run('DELETE FROM reminders WHERE task_id = ?', task.id);
        }
        if (!isOpen) await store.run("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND status = 'pending'", now, task.id);
      } else {
        task = await store.get(`
          INSERT INTO tasks (title, employee_id, start_at, estimate, location, category, site_latitude,
            site_longitude, maps_url, client_id, income_paise, priority, is_open, shoot_status, parent_shoot_id, delivery_due_at, payment_due_on, additional_sites, emergency, project_id, is_unscheduled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
        `, ...values);
      }
      if (crewChanged) {
        await store.run('DELETE FROM shoot_crew WHERE task_id = ?', task.id);
        for (const id of crew) await store.run('INSERT INTO shoot_crew (task_id, employee_id) VALUES (?, ?)', task.id, id);
        await store.run(`DELETE FROM reminders WHERE task_id = ?
          AND NOT EXISTS (SELECT 1 FROM task_assignments WHERE task_id = reminders.task_id AND employee_id = reminders.employee_id)`, task.id);
      }
      if (emergency && status === 'booked' && scheduleChanged && !completed) {
        await displaceEmergencyWork(store, task, [employee.id, ...crew], actor, now);
      }
      if (editingWork && !isOpen && status === 'booked' && !completed && scheduleChanged) {
        for (const id of [employee.id, ...crew]) {
          await notify(store, id, [emergency ? 'emergency' : 'assigned', task.id, task.start_at, task.estimate].join(':'),
            emergency ? 'Emergency shoot assigned' : 'Work assignment updated', title, now, task.id);
        }
      }
      await recordBusinessAudit(store, actor.id, 'task', task.id, emergency && !current ? 'emergency assignment' : current ? 'updated' : 'created', now,
        { before: current ? { startAt: current.start_at, estimate: current.estimate, employee: current.employee_id, status: current.shoot_status, crew: storedCrew } : null,
          after: { startAt: recordedStart, estimate, employee: employee.id, status, crew, projectId }, reason: optional(body.reason, 'administrative remark', 350) });
      await refreshReminders(store, now);
      if (delegated) return { id: task.id, title: task.title, project_id: projectId, start_at: task.start_at, estimate: task.estimate };
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

  function decideRequest(body, actor, now) {
    if (!['approved', 'declined'].includes(body.status)) throw new RequestError('Choose approve or decline.');
    return db.transaction(async (store) => {
      const request = await store.get('SELECT * FROM work_requests WHERE id = ?', idValue(body.id));
      if (request?.status !== 'pending') throw new RequestError('This request is no longer pending.', 409);
      const task = await getTask(request.task_id, store);
      if (body.status === 'approved') {
        if (!task.is_open || task.shoot_status !== 'booked' || task.completed_at || task.start_at + task.estimate * 60_000 <= now) throw new RequestError('This opportunity is closed.', 409);
        const employee = await getEmployee(request.employee_id, store);
        if (employee.deactivated) throw new RequestError('The employee’s account is inactive.', 409);
        if (task.category === 'Photo shoot') {
          await checkScheduleConflicts(store, { employeeIds: [request.employee_id], startAt: task.start_at,
            endAt: task.start_at + task.estimate * 60_000, taskId: task.id, acknowledged: body.acknowledgedConflicts });
        }
        await store.run('UPDATE tasks SET employee_id = ?, is_open = 0, priority = 1 WHERE id = ?', request.employee_id, task.id);
        await store.run("UPDATE work_requests SET status = 'declined', decided_at = ? WHERE task_id = ? AND id != ? AND status = 'pending'", now, task.id, request.id);
        await refreshReminders(store, now);
      }
      const decision = await store.get('UPDATE work_requests SET status = ?, decided_at = ? WHERE id = ? RETURNING *', body.status, now, request.id);
      await recordBusinessAudit(store, actor.id, 'work request', request.id, body.status, now, { taskId: task.id, employeeId: request.employee_id });
      await notify(store, request.employee_id, 'work-request:' + request.id, 'Work request ' + body.status, task.title, now, task.id);
      return decision;
    });
  }

  function recordPayment(body, actor, now) {
    const amount = paise(body.amount);
    const date = ledgerDate(body.date, now);
    const note = optional(body.note, 'payment reference', 300);
    return db.transaction(async (store) => {
      const existing = body.id ? await store.get('SELECT * FROM payments WHERE id = ?', idValue(body.id)) : null;
      if (body.id && !existing) throw new RequestError('Payment not found.', 404);
      const task = await getTask(existing?.task_id ?? body.taskId, store);
      if (task.category !== 'Photo shoot') throw new RequestError('Choose a shoot to record payment.');
      if (!existing && task.shoot_status === 'cancelled') throw new RequestError('Rebook the shoot before recording another payment.', 409);
      const { total: paid } = await store.get('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payments WHERE task_id = ?', task.id);
      if (amount > task.income_paise - paid + (existing?.amount_paise ?? 0)) {
        throw new RequestError('Payment exceeds the outstanding balance.');
      }
      const category = optional(body.category, 'payment category', 100) || existing?.category || 'Shoot payment';
      const row = existing
        ? await store.get('UPDATE payments SET amount_paise=?, paid_on=?, note=?, category=? WHERE id=? RETURNING *', amount, date, note, category, existing.id)
        : await store.get('INSERT INTO payments(task_id,amount_paise,paid_on,note,category) VALUES (?,?,?,?,?) RETURNING *', task.id, amount, date, note, category);
      await recordBusinessAudit(store, actor.id, 'payment', row.id, existing ? 'payment updated' : 'payment added', now,
        { taskId: task.id, oldAmount: existing?.amount_paise ?? null, amount, date, category });
      return row;
    });
  }
  function recordAttendance(actor, command, now) {
    const employeeId = actor.id;
    return db.transaction(async (store) => {
      if (!await store.get('SELECT 1 FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0', employeeId)) {
        throw new RequestError('Sign in to record attendance.', 401);
      }
      if (command.taskId != null && command.action === 'in') await ownTask(command.taskId, { id: employeeId }, store);
      const latest = await store.get('SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1', employeeId);
      if (command.action === 'end-shift') return hours.endShift(store, latest, command, actor, now);
      const tasks = await store.all(`
        SELECT tasks.* FROM tasks JOIN task_assignments ON tasks.id = task_assignments.task_id
        WHERE task_assignments.employee_id = ? AND category = 'Photo shoot'
      `, employeeId);
      const eligible = tasks.map((task) => ({ ...task, crew: [{ employee_id: employeeId }] }));
      const policy = await store.get('SELECT shoot_radius_m, max_accuracy_m, boundary_samples, boundary_delay_ms FROM hr_settings WHERE id = 1');
      const change = attendanceTransition({ command, latest, office: await officeSite(store), tasks: eligible, employeeId, now, policy });
      if (command.action === 'observe' && latest?.id === command.shiftId) {
        if (change) {
          const first = await store.get('SELECT * FROM attendance_boundary WHERE employee_id = ?', employeeId);
          const validFirst = first?.attendance_id === latest.id && first.observed_at >= now - boundarySampleAge;
          if (!validFirst) {
            await store.run(`
              INSERT INTO attendance_boundary(employee_id, attendance_id, observed_at, captured_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(employee_id) DO UPDATE SET attendance_id = excluded.attendance_id,
                observed_at = excluded.observed_at, captured_at = excluded.captured_at, samples = 1
            `, employeeId, latest.id, now, command.location.capturedAt);
            return { boundaryPending: true };
          }
          if (now - first.observed_at < policy.boundary_delay_ms || command.location.capturedAt - first.captured_at < policy.boundary_delay_ms) {
            return { boundaryPending: true };
          }
          if (first.samples + 1 < policy.boundary_samples) {
            await store.run('UPDATE attendance_boundary SET samples = samples + 1, observed_at = ?, captured_at = ? WHERE employee_id = ?',
              now, command.location.capturedAt, employeeId);
            return { boundaryPending: true };
          }
        }
        await store.run('DELETE FROM attendance_boundary WHERE employee_id = ?', employeeId);
      } else if (change) {
        await store.run('DELETE FROM attendance_boundary WHERE employee_id = ?', employeeId);
      }
      let shift = null;
      if (change?.type === 'open') {
        await store.run('UPDATE attendance SET resume_pending = 0 WHERE employee_id = ? AND resume_pending = 1', employeeId);
        shift = await store.get(`
          INSERT INTO attendance (employee_id, clock_in, in_location, site, in_reason, last_verified_at)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING *
        `, employeeId, now, JSON.stringify(change.location), JSON.stringify(change.site), change.reason, now);
        if (change.site.taskId) {
          const travel = await store.get("SELECT * FROM work_periods WHERE employee_id = ? AND kind = 'travel' AND task_id = ? AND end_at IS NULL", employeeId, change.site.taskId);
          await hours.endPeriod(store, travel, employeeId, now);
          await store.run('UPDATE task_sessions SET end_at = ? WHERE employee_id = ? AND end_at IS NULL', now, employeeId);
          await store.run('INSERT INTO task_sessions (task_id, employee_id, start_at) VALUES (?, ?, ?)', change.site.taskId, employeeId, now);
        }
      }
      if (change?.type === 'close') {
        await endAttendanceGap(store, change.shiftId, now);
        shift = await store.get(`
          UPDATE attendance SET clock_out = ?, out_location = ?, out_reason = ?, resume_pending = ? WHERE id = ? RETURNING *
        `, now, JSON.stringify(change.location), change.reason, Number(change.reason === 'geofence'), change.shiftId);
        if (change.taskId) {
          await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND employee_id = ? AND end_at IS NULL', now, change.taskId, employeeId);
        }
      }
      if (shift) await recordBusinessAudit(store, actor.id, 'attendance', shift.id,
        change.type === 'open' ? 'checked in' : 'checked out', now, { reason: change.reason, taskId: change.site?.taskId ?? change.taskId });
      if (change?.type === 'verify') {
        await endAttendanceGap(store, change.shiftId, now);
        await store.run('UPDATE attendance SET last_verified_at = ? WHERE id = ?', now, change.shiftId);
      }
      if (change?.type === 'cancel') {
        await store.run('UPDATE attendance SET resume_pending = 0 WHERE id = ?', change.shiftId);
      }
      return shift;
    });
  }

  function taskAction(body, actor, now) {
    return db.transaction(async (store) => {
      if (!await store.get('SELECT 1 FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0', actor.id)) {
        throw new RequestError('Sign in to update work.', 401);
      }
      const task = await ownTask(body.taskId, actor, store);
      if (task.completed_at || task.shoot_status !== 'booked') throw new RequestError('This work is closed.', 409);
      if (task.work_state !== 'ready') throw new RequestError('This task needs administrative review first.', 409);
      if (body.action === 'acknowledge') {
        return store.get('UPDATE tasks SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ? RETURNING *', now, task.id);
      }
      if (['complete','submit-completion','block','unblock'].includes(body.action) &&
          await store.get('SELECT 1 FROM footage_checks WHERE task_id = ?', task.id)) {
        throw new RequestError('Use the storage verification workflow for this task.', 409);
      }
      if (task.category !== 'Photo shoot' && ['start','submit-completion'].includes(body.action) && !task.acknowledged_at) {
        throw new RequestError('Acknowledge this task before starting or submitting work.', 409);
      }
      if (body.action === 'submit-completion') {
        if (task.category === 'Photo shoot' || !await store.get('SELECT 1 FROM task_sessions WHERE task_id = ? AND employee_id = ?', task.id, actor.id)) {
          throw new RequestError('Start the task before submitting work for review.', 409);
        }
        const fileId = body.fileId || null;
        if (fileId && (!isFileIdentifier(fileId) || !await store.get(`
          SELECT 1 FROM private_files WHERE id = ? AND kind = 'task' AND record_id = ? AND removed_at IS NULL
        `, fileId, task.id))) throw new RequestError('Choose an available attachment for this task.');
        if (task.evidence_required && !fileId && !task.completion_file_id) throw new RequestError('Attach completion evidence for this task.');
        const report = text(body.report, 'completion evidence or report', 3000);
        await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND employee_id = ? AND end_at IS NULL', now, task.id, actor.id);
        const updated = await store.get("UPDATE tasks SET work_state = 'review', completion_report = ?, completion_file_id = COALESCE(?, completion_file_id) WHERE id = ? RETURNING *", report, fileId, task.id);
        await recordBusinessAudit(store, actor.id, 'task', task.id, 'completion submitted', now, { fileId: updated.completion_file_id });
        await notifyAdmins(store, 'completion:' + task.id + ':' + now, 'Task completion awaiting review', task.title, now, task.id);
        return updated;
      }
      if (body.action === 'complete' && task.category !== 'Photo shoot') throw new RequestError('Submit this task for completion review.', 409);

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
        if (await store.get('SELECT 1 FROM work_periods WHERE employee_id = ? AND end_at IS NULL', actor.id)) {
          throw new RequestError('End your break or shoot travel before starting a task.', 409);
        }
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
        const completed = await store.get('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *', now, task.id);
        if (completed.category === 'Photo shoot') await footage.onShootCompleted(store, completed, actor.id, now);
        return completed;
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

  function finishShoot(body, actor, now) {
    return db.transaction(async (store) => {
      const shoot = await getTask(body.taskId, store);
      if (shoot.category !== 'Photo shoot' || shoot.completed_at || shoot.is_open || shoot.shoot_status !== 'booked') {
        throw new RequestError('Only a booked, assigned shoot can be marked done.', 409);
      }
      await ensureShootInactive(store, shoot);
      const completed = await store.get('UPDATE tasks SET completed_at = ? WHERE id = ? RETURNING *', now, shoot.id);
      await footage.onShootCompleted(store, completed, actor.id, now);
      return completed;
    });
  }

  return async function api(req, res, path) {
    const now = Date.now();
    if (req.method === 'POST' && path === '/api/login') return signIn(req, res, await readBody(req, siteOrigin), now);
    const actor = await authenticatedEmployee(db, req, now);
    if (req.method === 'GET' && path === '/api/session') return { actor };
    if (actor && req.method === 'GET' && path === '/api/settings/history') {
      adminOnly(actor);
      const [current, history] = await Promise.all([
        db.get('SELECT * FROM hr_settings WHERE id = 1'),
        db.all('SELECT effective_from, settings, changed_at FROM attendance_policies ORDER BY effective_from DESC LIMIT 40'),
      ]);
      return { current, history };
    }
    if (actor && req.method === 'GET' && path === '/api/scopes') return delegation.scopeList(actor);
    if (actor && req.method === 'GET' && path === '/api/scoped-work') return delegation.desk(actor);
    if (actor && req.method === 'GET' && path === '/api/roles') return delegation.roleMatrix(actor);
    if (actor && req.method === 'GET' && path === '/api/attendance/offline-key') return offlineAttendance.provision(actor);
    if (actor && req.method === 'GET' && path === '/api/reviews') return delegation.queue(actor);
    if (actor && req.method === 'GET' && path === '/api/operations/audit') return operations.audit(actor);
    if (actor && req.method === 'GET' && path === '/api/profile') {
      return (await db.get('SELECT note, version FROM personal_notes WHERE employee_id = ?', actor.id)) ?? { note: '', version: 0 };
    }
    if (actor && req.method === 'GET' && path === '/api/access-audit') {
      adminOnly(actor);
      return db.all(`
        SELECT access_audit.action, access_audit.occurred_at, subject.name AS subject, performer.name AS performer
        FROM access_audit LEFT JOIN employees subject ON access_audit.subject_id = subject.id
        LEFT JOIN employees performer ON access_audit.actor_id = performer.id
        ORDER BY occurred_at DESC, access_audit.id DESC LIMIT 100
      `);
    }
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
      if (actor) await audit(db, actor.id, actor.id, 'Signed out', now);
      return endSession(db, req, res, sessionOptions);
    }
    if (!actor) throw new RequestError('Sign in to open the workspace.', 401);
    if (path === '/api/profile/photo') {
      if (body.fileId !== null && !isFileIdentifier(body.fileId)) throw new RequestError('Choose a valid profile photo.');
      return setProfilePhoto(db, actor, body.employeeId === undefined ? actor.id : idValue(body.employeeId), body.fileId, now, RequestError);
    }
    if (path === '/api/profile/password') return changePassword(body, actor, now);
    if (path === '/api/profile/notes') return db.transaction((store) => offlineWork.saveNote(store, body, actor, now));
    if (path === '/api/task-draft') return db.transaction((store) => offlineWork.saveTaskDraft(store, body, actor, now));
    if (path === '/api/offline/synchronize') return offlineWork.synchronize(body, actor, now);
    if (path === '/api/offline/recover') return offlineWork.recover(body, actor);
    if (calendar) {
      if (path === '/api/calendar/issue') return calendar.issue(db, actor);
      if (path === '/api/calendar/revoke') return calendar.revoke(db, actor.id);
    }
    if (mobilePush) {
      if (path === '/api/push/status') return mobilePush.status(db, actor.id, body.endpoint);
      if (path === '/api/push/updates') return mobilePush.setUpdates(db, actor.id, body);
    if (path === '/api/push/register') return mobilePush.register(db, actor.id, body);
      if (path === '/api/push/remove') return mobilePush.remove(db, actor.id, body.endpoint);
      if (path === '/api/push/test') return mobilePush.testDevice(db, actor.id, body.endpoint);
    }
    if (path === '/api/attendance') {
      return recordAttendance(actor, body, now);
    }
    if (path === '/api/attendance/offline-departure') return offlineAttendance.sync(body, actor, now);
    if (path === '/api/attendance/period') return hours.workPeriod(body, actor, now);
    if (path === '/api/attendance/review-shift') return hours.reviewShift(body, actor, now);
    if (path === '/api/projects/detail') return projects.report(body, actor);
    if (path === '/api/projects') return projects.save(body, actor, now);
    if (path === '/api/projects/resource') return projects.resource(body, actor, now);
    if (path === '/api/revenue/allocations') return revenue.allocationDetails(body, actor);
    if (path === '/api/revenue/save') return revenue.save(body, actor, now);
    if (path === '/api/revenue/report') return revenue.report(body, actor, now);
    if (path === '/api/footage/historical') return footage.historical(body, actor, now);
    if (path === '/api/footage/manager') return footage.assignManager(body, actor, now);
    if (path === '/api/footage/submit') return footage.submit(body, actor, now);
    if (path === '/api/footage/review') return footage.review(body, actor, now);
    if (path === '/api/worksheet') {
      const report = await hours.worksheet(body, actor, now);
      const contribution = await revenue.report(body, actor, now);
      return { ...report, revenueContribution: contribution.total };
    }
    if (path === '/api/worksheet/remark') return hours.remark(body, actor, now);
    if (path === '/api/operations/plan') return operations.planDraft(body, actor, now);
    if (path === '/api/operations/submit-plan') return operations.submitPlan(body, actor, now);
    if (path === '/api/operations/review-plan') return operations.reviewPlan(body, actor, now);
    if (path === '/api/operations/task-change') return operations.requestTaskChange(body, actor, now);
    if (path === '/api/operations/review-change') return operations.reviewTaskChange(body, actor, now);
    if (path === '/api/operations/completion') return operations.reviewCompletion(body, actor, now);
    if (path === '/api/task-action') return taskAction(body, actor, now);
    if (path === '/api/work-requests') return submitRequest(body, actor, now);
    if (path === '/api/reminders/read') {
      await db.run('UPDATE reminders SET read_at = ? WHERE employee_id = ? AND read_at IS NULL', now, actor.id);
      await operations.readNotices(actor, now);
      return { ok: true };
    }
    if (path === '/api/hr/requests') return hr.submit(body, actor, now);
    if (path === '/api/hr/review') return hr.review(body, actor, now);
    if (path === '/api/hr/work-logs') return hr.log(body, actor, now);
    if (path === '/api/tasks') return saveTask(body, actor, now);
    if (path === '/api/clients') return saveClient(body, actor, now);
    if (path === '/api/audit/search') return searchAudit(db, body, actor, RequestError);
    adminOnly(actor);
    if (path === '/api/scopes') return delegation.changeScope(body, actor, now);
    if (path.startsWith('/api/hr/')) return hr.manage(path, body, now, actor);
    if (path === '/api/roles') return delegation.save(body, actor, now);
    if (path === '/api/roles/assign') return delegation.assign(body, actor, now);
    if (path === '/api/shoot-done') return finishShoot(body, actor, now);
    if (path === '/api/employees') return saveEmployee(body, actor, now);
    if (path === '/api/employees/access') return changeAccess(body, actor, now);
    if (path === '/api/request-decisions') return decideRequest(body, actor, now);
    if (path === '/api/payments') return recordPayment(body, actor, now);
    if (path === '/api/payment-due') {
      const date = paymentDueDate(body.paymentDueOn);
      return db.transaction(async (store) => {
        const shoot = await getTask(body.taskId, store);
        if (shoot.category !== 'Photo shoot') throw new RequestError('Shoot not found.', 404);
        const row = await store.get('UPDATE tasks SET payment_due_on = ? WHERE id = ? RETURNING id, payment_due_on', date, shoot.id);
        await recordBusinessAudit(store, actor.id, 'payment due date', shoot.id, 'due date updated', now, { previous: shoot.payment_due_on, date });
        return row;
      });
    }
    if (path === '/api/expenses') {
      const values = [text(body.name, 'expense name'), text(body.category, 'expense category'), paise(body.amount),
        ledgerDate(body.date, now), optional(body.note, 'expense notes', 300)];
      return db.transaction(async (store) => {
        const previous = body.id ? await store.get('SELECT * FROM expenses WHERE id = ?', idValue(body.id)) : null;
        if (body.id && !previous) throw new RequestError('Expense not found.', 404);
        const entry = previous
          ? await store.get('UPDATE expenses SET name=?, category=?, amount_paise=?, spent_on=?, note=? WHERE id=? RETURNING *', ...values, previous.id)
          : await store.get('INSERT INTO expenses(name,category,amount_paise,spent_on,note) VALUES (?,?,?,?,?) RETURNING *', ...values);
        await recordBusinessAudit(store, actor.id, 'expense', entry.id, previous ? 'expense updated' : 'expense added', now, { previous, entry });
        return entry;
      });
    }
    if (path === '/api/office') {
      const name = text(body.name, 'office name');
      const [site, sites] = await Promise.all([siteFrom(body),
        body.additionalSites === undefined ? null : additionalSitesFrom(body.additionalSites)]);
      return db.transaction(async (store) => {
        const previous = await officeSite(store);
        const additional = sites ?? JSON.parse(previous?.additional_sites ?? '[]');
        const keys = [site, ...additional].map(coordinateKey);
        if (new Set(keys).size !== keys.length) throw new RequestError('Enter distinct office locations.');
        const address = body.address === undefined ? previous?.address ?? null : optional(body.address, 'office address', 350);
        const row = await store.get(`
          INSERT INTO office (id, name, latitude, longitude, maps_url, address, additional_sites) VALUES (1, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude,
            longitude = excluded.longitude, maps_url = excluded.maps_url, address = excluded.address, additional_sites = excluded.additional_sites
          RETURNING *
        `, name, site.latitude, site.longitude, site.maps_url, address, JSON.stringify(additional));
        await recordBusinessAudit(store, actor.id, 'office locations', 1, 'locations updated', now, { before: previous, after: row });
        return row;
      });
    }
    throw new RequestError('Route not found.', 404);
  };
}
