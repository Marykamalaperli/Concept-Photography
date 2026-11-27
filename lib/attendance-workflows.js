import { dayLength, dayStart, studioDay, validDay, weekday } from './hr-policy.js';
import { dailyHours } from './work-hours.js';
import { AttendanceError, presenceAt, verifyFix } from './attendance-policy.js';
import { endAttendanceGap } from './attendance-gaps.js';
import { nextWorkingDay, notify, notifyAdmins, recordBusinessAudit } from './studio-notices.js';

export function createAttendanceWorkflows(db, { RequestError, idValue, text, optional }) {
  const kinds = { lunch: 'Lunch', personal: 'Personal break', travel: 'Shoot travel' };
  const adminOnly = (actor) => {
    if (!actor.is_admin) throw new RequestError('This action is available to the administrator only.', 403);
  };

  async function personFor(actor, input) {
    const id = input == null || input === '' ? actor.id : idValue(input);
    if (!actor.is_admin && id !== actor.id) throw new RequestError('You can access only your worksheet.', 403);
    const person = await db.get('SELECT id, name, employment_start FROM employees WHERE id = ? AND archived = 0', id);
    if (!person) throw new RequestError('Employee not found.', 404);
    return person;
  }

  function snapshot(actor) {
    return Promise.all([
      db.all('SELECT * FROM work_periods WHERE employee_id = ? AND (end_at IS NULL OR end_at >= ?) ORDER BY start_at DESC', actor.id, Date.now() - dayLength * 2),
      db.all(`
        SELECT s.*, e.name AS employee_name FROM shift_reviews s JOIN employees e ON e.id = s.employee_id
        ${actor.is_admin ? '' : 'WHERE s.employee_id = ?'}
        ORDER BY s.status = 'pending' DESC, s.ended_at DESC LIMIT 100
      `, ...(actor.is_admin ? [] : [actor.id])),
    ]).then(([workPeriods, shiftReviews]) => ({ workPeriods, shiftReviews }));
  }

  function workPeriod(body, actor, now) {
    return db.transaction(async (store) => {
      const active = await store.get('SELECT * FROM work_periods WHERE employee_id = ? AND end_at IS NULL', actor.id);
      if (body.action === 'end') {
        if (!active || idValue(body.id) !== active.id) throw new RequestError('Refresh to see the current break or travel status.', 409);
        return endPeriod(store, active, actor.id, now);
      }
      if (body.action !== 'start' || !Object.hasOwn(kinds, body.kind)) throw new RequestError('Choose a break or shoot travel.');
      if (active) throw new RequestError('End the current break or trip first.', 409);
      const shift = await store.get('SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1', actor.id);
      const travel = body.kind === 'travel';
      if (!shift || (shift.clock_out != null && (!travel || !shift.resume_pending))) {
        throw new RequestError('Check in before starting a break or shoot travel.', 409);
      }
      const taskId = travel ? idValue(body.taskId) : null;
      if (travel && !await store.get(`
        SELECT 1 FROM tasks t JOIN task_assignments a ON a.task_id = t.id
        WHERE t.id = ? AND a.employee_id = ? AND t.category = 'Photo shoot' AND t.is_open = 0 AND
          t.completed_at IS NULL AND t.shoot_status = 'booked' AND t.start_at < ? AND (t.start_at + t.estimate * 60000) > ?
      `, taskId, actor.id, now + 6 * 60 * 60_000, now - 6 * 60 * 60_000)) {
        throw new RequestError('Choose an assigned shoot within six hours of the trip.', 409);
      }
      const note = optional(body.note, 'period note', 600);
      await store.run('UPDATE task_sessions SET end_at = ? WHERE employee_id = ? AND end_at IS NULL', now, actor.id);
      const row = await store.get(`
        INSERT INTO work_periods(employee_id, kind, start_at, task_id, note) VALUES (?, ?, ?, ?, ?) RETURNING *
      `, actor.id, body.kind, now, taskId, note);
      await recordBusinessAudit(store, actor.id, 'work period', row.id, 'started', now, { kind: row.kind, taskId });
      if (row.kind === 'lunch') await notify(store, actor.id, 'lunch-start:' + row.id, 'Lunch started', 'Your lunch timer is running.', now);
      return row;
    });
  }

  async function endPeriod(store, active, actorId, now) {
    if (!active) return null;
    const row = await store.get('UPDATE work_periods SET end_at = ? WHERE id = ? AND end_at IS NULL RETURNING *', now, active.id);
    if (!row) return null;
    await recordBusinessAudit(store, actorId, 'work period', active.id, 'ended', now, { kind: active.kind });
    if (active.kind === 'lunch') await notify(store, active.employee_id, 'lunch-ended:' + row.id, 'Lunch completed', 'Your lunch break has been recorded.', now);
    return row;
  }

  async function source(store, employeeId, start, end, now) {
    const from = studioDay(start);
    const to = studioDay(end - 1);
    const [attendance, periods, requests, settings, holidays] = await Promise.all([
      store.all('SELECT * FROM attendance WHERE employee_id = ? AND clock_in < ? AND COALESCE(clock_out, ?) > ? ORDER BY clock_in', employeeId, end, now, start),
      store.all('SELECT * FROM work_periods WHERE employee_id = ? AND start_at < ? AND COALESCE(end_at, ?) > ? ORDER BY start_at', employeeId, end, now, start),
      store.all("SELECT * FROM hr_requests WHERE employee_id = ? AND status = 'approved' AND day_from <= ? AND day_to >= ? ORDER BY decided_at DESC, id DESC", employeeId, to, from),
      store.get('SELECT * FROM hr_settings WHERE id = 1'),
      store.all('SELECT day, name FROM holidays ORDER BY day'),
    ]);
    return { attendance, periods, requests, settings, holidays };
  }

  async function finishShift(store, latest, actor, now) {
    const previous = await store.get('SELECT * FROM shift_reviews WHERE attendance_id = ?', latest.id);
    if (previous) return previous;
    const date = studioDay(now);
    const start = dayStart(date);
    const person = await store.get('SELECT id, name, employment_start, is_admin FROM employees WHERE id = ?', actor.id);
    const work = await source(store, actor.id, start, start + dayLength, now);
    const hours = dailyHours({ ...work, employee: person, date, now });
    const unverified = !['manual', 'geofence', 'shift-ended'].includes(latest.out_reason);
    const holidays = new Set(work.holidays.map((row) => row.day));
    const leaves = await store.all("SELECT day_from, day_to, leave_type FROM hr_requests WHERE employee_id = ? AND kind = 'leave' AND status = 'approved' AND day_to >= ?", actor.id, date);
    const next = !person.is_admin && nextWorkingDay(date, work.settings.week_off, holidays, leaves);
    const missing = next && !await store.get("SELECT 1 FROM daily_plans WHERE employee_id = ? AND work_day = ? AND status IN ('submitted', 'approved')", actor.id, next);
    const review = await store.get(`
      INSERT INTO shift_reviews(employee_id, attendance_id, work_day, ended_at, required_ms, recorded_ms, next_plan_day, location_unverified, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, actor.id, latest.id, date, now, hours.required, hours.actual, missing ? next : null, Number(unverified),
    hours.remaining || missing || unverified ? 'pending' : 'accepted');
    await recordBusinessAudit(store, actor.id, 'attendance', latest.id, 'shift ended', now, {
      outReason: latest.out_reason, shortfallMs: hours.remaining, missingPlan: missing ? next : null,
    });
    if (missing) {
      await notify(store, actor.id, 'late-next:' + next, 'Daily plan overdue', 'Submit your plan for ' + next + '.', now);
      await notifyAdmins(store, 'late-next:' + actor.id + ':' + next, 'Employee plan overdue', person.name + ' · ' + next, now);
    }
    if (review.status === 'pending') {
      await notifyAdmins(store, 'shift-review:' + review.id, 'Shift needs review', person.name + ' · ' + date, now);
      await notify(store, actor.id, 'shift-review:' + review.id, 'Shift recorded for review', 'See the attendance worksheet for details.', now);
    }
    return review;
  }

  async function endShift(store, latest, body, actor, now) {
    if (!latest || idValue(body.shiftId) !== latest.id) throw new RequestError('Refresh to see the current shift before ending it.', 409);
    const review = await store.get('SELECT * FROM shift_reviews WHERE attendance_id = ?', latest.id);
    if (review) return review;
    if (latest.clock_out != null && !latest.resume_pending) throw new RequestError('No shift is active.', 409);
    let location = null;
    if (body.location && latest.site && latest.clock_out == null) {
      const site = JSON.parse(latest.site);
      try {
        const fix = verifyFix(body.location, now);
        const presence = presenceAt(fix, site);
        if (presence !== 'uncertain') location = presence === 'inside' ? { ...fix, label: site.name } : fix;
      } catch (error) {
        if (!(error instanceof AttendanceError)) throw error;
      }
    }
    const shift = latest.clock_out == null ? await store.get(`
      UPDATE attendance SET clock_out = ?, out_location = ?, out_reason = ?, resume_pending = 0
      WHERE id = ? RETURNING *
    `, now, location ? JSON.stringify(location) : null, location ? 'shift-ended' : 'employee-reported', latest.id) : latest;
    await store.run('UPDATE attendance SET resume_pending = 0 WHERE employee_id = ? AND resume_pending = 1', actor.id);
    await store.run('DELETE FROM attendance_boundary WHERE employee_id = ?', actor.id);
    await endAttendanceGap(store, latest.id, now);
    const period = await store.get('SELECT * FROM work_periods WHERE employee_id = ? AND end_at IS NULL', actor.id);
    await endPeriod(store, period, actor.id, now);
    await store.run('UPDATE task_sessions SET end_at = ? WHERE employee_id = ? AND end_at IS NULL', now, actor.id);
    return finishShift(store, shift, actor, now);
  }

  function reviewShift(body, actor, now) {
    adminOnly(actor);
    if (!['accepted', 'follow-up'].includes(body.status)) throw new RequestError('Choose accept or follow up.');
    const note = text(body.note, 'review note', 800);
    return db.transaction(async (store) => {
      const review = await store.get("SELECT * FROM shift_reviews WHERE id = ? AND status != 'accepted'", idValue(body.id));
      if (!review) throw new RequestError('This shift review has already closed.', 409);
      const row = await store.get('UPDATE shift_reviews SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? RETURNING *',
        body.status, note, actor.id, now, review.id);
      await recordBusinessAudit(store, actor.id, 'shift review', review.id, row.status, now, { note });
      await notify(store, row.employee_id, 'shift-reviewed:' + row.id + ':' + now, 'Shift review updated', row.work_day + ' · ' + note, now);
      return row;
    });
  }

  async function worksheet(body, actor, now) {
    const date = body.date;
    if (!validDay(date) || date > studioDay(now) || !['day', 'week', 'month'].includes(body.period)) {
      throw new RequestError('Choose a valid date and reporting period.');
    }
    const employee = await personFor(actor, body.employeeId);
    const anchor = dayStart(date);
    const month = body.period === 'month';
    const week = body.period === 'week';
    const start = month ? dayStart(date.slice(0, 7) + '-01') : week ? anchor - ((weekday(date) + 6) % 7) * dayLength : anchor;
    const periodEnd = month ? dayStart(studioDay(start + 32 * dayLength).slice(0, 7) + '-01') : start + (week ? 7 : 1) * dayLength;
    const end = Math.min(periodEnd, dayStart(studioDay(now)) + dayLength);
    return db.transaction(async (store) => {
      const work = await source(store, employee.id, start, end, now);
      const [gaps, tasks, sessions, remarks, reviews] = await Promise.all([
        store.all(`SELECT g.*, a.clock_in, a.clock_out FROM attendance_gaps g JOIN attendance a ON a.id = g.attendance_id
          WHERE a.employee_id = ? AND g.start_at < ? AND COALESCE(g.resolved_at, ?) > ? ORDER BY g.start_at`, employee.id, end, now, start),
        store.all(`SELECT t.id, t.title, t.start_at, t.estimate, t.completed_at, t.work_state, t.shoot_status, t.location
          FROM tasks t WHERE EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id = t.id AND a.employee_id = ?
            AND t.start_at < ? AND t.start_at + 60000 * t.estimate > ?)
          OR EXISTS (SELECT 1 FROM task_sessions s WHERE s.task_id = t.id AND s.employee_id = ? AND s.start_at < ? AND COALESCE(s.end_at, ?) > ?)
          ORDER BY t.start_at`, employee.id, end, start, employee.id, end, now, start),
        store.all('SELECT * FROM task_sessions WHERE employee_id = ? AND start_at < ? AND COALESCE(end_at, ?) > ? ORDER BY start_at',
          employee.id, end, now, start),
        store.all('SELECT work_day, scope, remark, updated_at FROM worksheet_remarks WHERE employee_id = ? AND work_day >= ? AND work_day <= ?',
          employee.id, studioDay(start), studioDay(end - 1)),
        store.all('SELECT * FROM shift_reviews WHERE employee_id = ? AND work_day >= ? AND work_day <= ? ORDER BY ended_at',
          employee.id, studioDay(start), studioDay(end - 1)),
      ]);
      const days = [];
      for (let tick = start; tick < end; tick += dayLength) {
        const key = studioDay(tick);
        days.push({ date: key, ...dailyHours({ ...work, attendance: work.attendance, periods: work.periods.filter((row) =>
          row.start_at < tick + dayLength && (row.end_at ?? now) > tick), employee, date: key, now }) });
      }
      const corrections = work.requests.filter((row) => row.kind === 'time').map(({ day_from, clock_in, clock_out, reason, decided_at }) =>
        ({ day_from, clock_in, clock_out, reason, decided_at }));
      return { employee, from: studioDay(start), to: studioDay(end - 1), start, end, now, days, attendance: work.attendance,
        periods: work.periods, corrections, gaps, tasks, sessions, remarks, reviews };
    });
  }

  async function remark(body, actor, now) {
    if (!validDay(body.date) || body.date > studioDay(now)) throw new RequestError('Choose a valid worksheet date.');
    const person = await personFor(actor, body.employeeId);
    const scope = actor.is_admin ? 'admin' : 'employee';
    const note = text(body.remark, 'worksheet remark', 800);
    return db.transaction(async (store) => {
      const previous = await store.get('SELECT remark FROM worksheet_remarks WHERE employee_id = ? AND work_day = ? AND scope = ?', person.id, body.date, scope);
      const row = await store.get(`
        INSERT INTO worksheet_remarks(employee_id, work_day, scope, remark, written_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, work_day, scope) DO UPDATE SET remark = excluded.remark, written_by = excluded.written_by, updated_at = excluded.updated_at
        RETURNING *
      `, person.id, body.date, scope, note, actor.id, now);
      await recordBusinessAudit(store, actor.id, 'worksheet', person.id, scope + ' remark updated', now,
        { date: body.date, previous: previous?.remark ?? null, remark: row.remark });
      return row;
    });
  }

  return { snapshot, workPeriod, endPeriod, endShift, finishShift, reviewShift, worksheet, remark };
}
