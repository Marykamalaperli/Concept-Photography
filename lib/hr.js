import { can } from './delegation.js';
import { recordBusinessAudit } from './studio-notices.js';
import { studioDay, dayStart, dayLength, validDay, leaveDays, timeForDay } from './hr-policy.js';

const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const leaveTypes = ['casual', 'half', 'unpaid'];

export function createHr(db, { RequestError, idValue, text, optional, paise }) {
  const settings = (store) => store.get('SELECT * FROM hr_settings WHERE id = 1');
  const holidays = (store) => store.all('SELECT day, name FROM holidays ORDER BY day');
  const readDate = (value) => {
    if (!validDay(value)) throw new RequestError('Choose a valid date.');
    return value;
  };
  const readClock = (value) => {
    if (!value) return null;
    if (typeof value !== 'string' || !clockPattern.test(value)) throw new RequestError('Enter a valid time.');
    return value;
  };

  async function staff(store, id) {
    const person = await store.get('SELECT id, employment_start FROM employees WHERE id = ? AND archived = 0', idValue(id));
    if (!person) throw new RequestError('Employee not found.', 404);
    return person;
  }

  async function snapshot(actor) {
    const visibility = actor.is_admin ? '' : 'WHERE employee_id = ?';
    const own = actor.is_admin ? [] : [actor.id];
    const [hrSettings, holidayList, hrRequests, workLogs, payslips, announcements] = await Promise.all([
      settings(db),
      holidays(db),
      db.all(`SELECT * FROM hr_requests ${visibility} ORDER BY requested_at DESC, id DESC`, ...own),
      db.all(`SELECT * FROM work_logs ${visibility} ORDER BY day DESC, id DESC`, ...own),
      db.all(`SELECT * FROM payslips ${visibility} ORDER BY period DESC, id DESC`, ...own),
      db.all('SELECT * FROM announcements ORDER BY published_at DESC, id DESC'),
    ]);
    return { hrSettings, holidays: holidayList, hrRequests, workLogs, payslips, announcements };
  }

  async function verifyTime(store, person, date, clockIn, clockOut, now) {
    if (clockIn == null && clockOut == null) throw new RequestError('Enter a corrected check-in or check-out time.');
    const previous = await store.get(`
      SELECT clock_in, clock_out FROM hr_requests
      WHERE employee_id = ? AND day_from = ? AND kind = 'time' AND status = 'approved'
      ORDER BY decided_at DESC, id DESC LIMIT 1
    `, person.id, date);
    const correctedIn = clockIn ?? previous?.clock_in ?? null;
    const correctedOut = clockOut ?? previous?.clock_out ?? null;
    const start = dayStart(date);
    if (date > studioDay(now) || correctedIn > now || correctedOut > now) throw new RequestError('Choose a date and times that have already passed.');
    const records = await store.all(`
      SELECT clock_in, clock_out FROM attendance
      WHERE employee_id = ? AND clock_in < ? AND (clock_out IS NULL OR clock_out >= ?)
    `, person.id, start + dayLength, start);
    if (records.some((record) => record.clock_out === null && studioDay(now) === date)) {
      throw new RequestError('Clock out before requesting or approving a correction for an active shift.', 409);
    }
    const current = timeForDay(records, date, now);
    const first = correctedIn ?? current.in;
    const last = correctedOut ?? current.out;
    if (first != null && last != null && first >= last) throw new RequestError('Check-out must be after check-in.');
    return [correctedIn, correctedOut];
  }

  function submit(body, actor, now) {
    const date = readDate(body.from);
    const reason = text(body.reason, 'reason', 800);
    if (!['leave', 'time'].includes(body.kind)) throw new RequestError('Choose a request type.');
    const time = body.kind === 'time';
    const end = time ? date : readDate(body.to);
    if (end < date || dayStart(end) - dayStart(date) >= 366 * dayLength) {
      throw new RequestError('Choose an end date on or after the start, within one year.');
    }
    const leaveType = time ? null : body.leaveType;
    if (!time && !leaveTypes.includes(leaveType)) throw new RequestError('Choose a leave type.');
    if (leaveType === 'half' && date !== end) throw new RequestError('Half-day leave applies to one date.');
    const inTime = time ? readClock(body.clockIn) : null;
    const outTime = time ? readClock(body.clockOut) : null;
    const clockIn = inTime ? Date.parse(date + 'T' + inTime + ':00+05:30') : null;
    const clockOut = outTime ? Date.parse(date + 'T' + outTime + ':00+05:30') : null;
    return db.transaction(async (store) => {
      const person = await staff(store, actor.id);
      if (person.employment_start && date < person.employment_start) throw new RequestError('Choose a date on or after your employment start date.');
      if (time) {
        await verifyTime(store, person, date, clockIn, clockOut, now);
      } else if (!leaveDays({ day_from: date, day_to: end }, await settings(store), await holidays(store)).length) {
        throw new RequestError('Choose at least one working day.');
      }
      const overlap = await store.get(`
        SELECT 1 FROM hr_requests WHERE employee_id = ? AND kind = ? AND day_from <= ? AND day_to >= ?
        AND (status = 'pending' OR (kind = 'leave' AND status = 'approved'))
      `, actor.id, body.kind, end, date);
      if (overlap) throw new RequestError('There is already a request covering these dates.', 409);
      return store.get(`
        INSERT INTO hr_requests (employee_id, kind, day_from, day_to, leave_type, clock_in, clock_out, reason, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
      `, actor.id, body.kind, date, end, leaveType, clockIn, clockOut, reason, now);
    });
  }

  function review(body, actor, now) {
    const cancel = body.status === 'cancelled';
    if (!cancel && !can(actor, 'review-attendance')) throw new RequestError('You do not have permission to review attendance requests.', 403);
    if (!cancel && !['approved', 'declined'].includes(body.status)) throw new RequestError('Choose approve or decline.');
    return db.transaction(async (store) => {
      const request = await store.get('SELECT * FROM hr_requests WHERE id = ?', idValue(body.id));
      if (!request || (cancel && request.employee_id !== actor.id)) throw new RequestError('Request not found.', 404);
      if (!cancel && !actor.is_admin && request.employee_id === actor.id) throw new RequestError('Another reviewer must review your request.', 403);
      if (request.status !== 'pending') throw new RequestError('This request is no longer pending.', 409);
      let clockIn = request.clock_in;
      let clockOut = request.clock_out;
      if (body.status === 'approved') {
        const person = await staff(store, request.employee_id);
        if (person.employment_start && request.day_from < person.employment_start) throw new RequestError('This request predates employment.');
        if (request.kind === 'time') {
          [clockIn, clockOut] = await verifyTime(store, person, request.day_from, clockIn, clockOut, now);
        }
        if (request.kind === 'leave' && !leaveDays(request, await settings(store), await holidays(store)).length) {
          throw new RequestError('The requested dates no longer include a working day.', 409);
        }
      }
      const reviewed = await store.get(`
        UPDATE hr_requests SET status = ?, decided_at = ?, decided_by = ?, clock_in = ?, clock_out = ?
        WHERE id = ? RETURNING *
      `, body.status, now, actor.id, clockIn, clockOut, request.id);
      await recordBusinessAudit(store, actor.id, request.kind === 'time' ? 'attendance correction' : 'leave request', request.id,
        body.status, now, { employeeId: request.employee_id, date: request.day_from, clockIn, clockOut });
      return reviewed;
    });
  }

  async function manage(path, body, now, actor) {
    if (path === '/api/hr/settings') {
      const start = readClock(body.workStart);
      const end = readClock(body.workEnd);
      if (Boolean(start) !== Boolean(end) || (start && start >= end)) throw new RequestError('Enter an office opening and closing time in order, or leave both blank.');
      const weekOff = Number(body.weekOff);
      const accrual = Number(body.monthlyLeave);
      if (body.weekOff == null || body.monthlyLeave == null || body.weekOff === '' || body.monthlyLeave === '' ||
          !Number.isInteger(weekOff) || weekOff < 0 || weekOff > 6 || !Number.isInteger(accrual) || accrual < 0 || accrual > 31) {
        throw new RequestError('Choose a weekly day off and a monthly casual-leave allowance from 0 to 31 days.');
      }
      const required = body.requiredMinutes == null ? null : Number(body.requiredMinutes);
      const grace = body.verificationGraceMinutes == null ? null : Number(body.verificationGraceMinutes);
      if ((required !== null && (body.requiredMinutes === '' || !Number.isInteger(required) || required < 0 || required > 1440)) ||
          (grace !== null && (!Number.isInteger(grace) || grace < 2 || grace > 60))) {
        throw new RequestError('Enter working minutes from 0 to 1,440 and a verification grace period from 2 to 60 minutes.');
      }
      const minutes = [body.lunchMinutes, body.personalBreakMinutes].map((value) => value == null ? null : Number(value));
      if (minutes.some((value) => value !== null && (!Number.isInteger(value) || value < 5 || value > 180))) {
        throw new RequestError('Choose a lunch and break duration between 5 and 180 minutes.');
      }
      const lunchStart = readClock(body.lunchStart);
      const limits = [['officeRadius', 50, 100], ['shootRadius', 50, 100], ['maxAccuracy', 5, 100]].map(([key, min, max]) => {
        const value = body[key] == null ? null : Number(body[key]);
        if (value !== null && (!Number.isInteger(value) || value < min || value > max)) {
          throw new RequestError('Choose geofence radii from 50 to 100 metres and maximum GPS accuracy from 5 to 100 metres.');
        }
        return value;
      });
      return db.transaction(async (store) => {
        const before = await settings(store);
        const after = await store.get(`
          UPDATE hr_settings SET work_start = ?, work_end = ?, week_off = ?, monthly_leave = ?,
            required_minutes = COALESCE(?, required_minutes), verification_grace_minutes = COALESCE(?, verification_grace_minutes),
            lunch_start = CASE WHEN ? THEN ? ELSE lunch_start END,
            lunch_minutes = COALESCE(?, lunch_minutes), personal_break_minutes = COALESCE(?, personal_break_minutes),
            office_radius_m = COALESCE(?, office_radius_m), shoot_radius_m = COALESCE(?, shoot_radius_m),
            max_accuracy_m = COALESCE(?, max_accuracy_m)
          WHERE id = 1 RETURNING *
        `, start, end, weekOff, accrual, required, grace, Number(Object.hasOwn(body, 'lunchStart')), lunchStart, ...minutes, ...limits);
        await recordBusinessAudit(store, actor.id, 'attendance policy', 1, 'settings updated', now, { before, after });
        return after;
      });
    }
    if (path === '/api/hr/holidays') {
      const day = readDate(body.day);
      if (body.remove) {
        await db.run('DELETE FROM holidays WHERE day = ?', day);
        return { ok: true };
      }
      return db.get('INSERT INTO holidays (day, name) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET name = excluded.name RETURNING *',
        day, text(body.name, 'holiday name'));
    }
    if (path === '/api/hr/payslips') {
      const period = typeof body.period === 'string' && body.period.length === 7 ? body.period : '';
      readDate(period + '-01');
      if (period > studioDay(now).slice(0, 7)) throw new RequestError('Choose this month or an earlier pay period.');
      const gross = paise(body.gross, true);
      const deductions = paise(body.deductions, true);
      if (deductions > gross) throw new RequestError('Deductions cannot exceed gross pay.');
      const note = optional(body.note, 'payslip notes', 800);
      return db.transaction(async (store) => {
        const person = await staff(store, body.employeeId);
        return store.get(`
          INSERT INTO payslips (employee_id, period, gross_paise, deductions_paise, note, published_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (employee_id, period) DO UPDATE SET gross_paise = excluded.gross_paise,
            deductions_paise = excluded.deductions_paise, note = excluded.note, published_at = excluded.published_at RETURNING *
        `, person.id, period, gross, deductions, note, now);
      });
    }
    if (path === '/api/hr/announcements') {
      if (body.remove) {
        await db.run('DELETE FROM announcements WHERE id = ?', idValue(body.id));
        return { ok: true };
      }
      const title = text(body.title, 'announcement title');
      const message = text(body.message, 'announcement', 1600);
      if (!body.id) return db.get('INSERT INTO announcements (title, message, published_at) VALUES (?, ?, ?) RETURNING *', title, message, now);
      const updated = await db.get('UPDATE announcements SET title = ?, message = ? WHERE id = ? RETURNING *', title, message, idValue(body.id));
      if (!updated) throw new RequestError('Announcement not found.', 404);
      return updated;
    }
    throw new RequestError('Route not found.', 404);
  }

  async function log(body, actor, now) {
    const date = readDate(body.day);
    if (date > studioDay(now) || (actor.employment_start && date < actor.employment_start)) throw new RequestError('Choose a work date up to today.');
    const minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new RequestError('Enter minutes from 0 to 1,440.');
    return db.get('INSERT INTO work_logs (employee_id, day, note, minutes, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
      actor.id, date, text(body.note, 'work summary', 600), minutes, now);
  }

  return { snapshot, submit, review, manage, log };
}
