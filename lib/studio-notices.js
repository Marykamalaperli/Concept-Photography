import { settingsAt } from './business-settings.js';
import { dayLength, dayStart, studioDay, weekday } from './hr-policy.js';

const minute = 60_000;

export function notify(store, employeeId, key, title, message, now, taskId = null) {
  return store.run(`
    INSERT INTO operation_notices(employee_id, event_key, title, message, task_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id, event_key) DO NOTHING
  `, employeeId, key, title, message, taskId, now);
}

export function notifyAdmins(store, key, title, message, now, taskId = null) {
  return store.run(`
    INSERT INTO operation_notices(employee_id, event_key, title, message, task_id, created_at)
    SELECT id, ?, ?, ?, ?, ? FROM employees WHERE is_admin = 1 AND archived = 0 AND deactivated = 0
    ON CONFLICT(employee_id, event_key) DO NOTHING
  `, key, title, message, taskId, now);
}

export function recordBusinessAudit(store, actorId, subject, recordId, action, now, details = {}) {
  return store.run(`
    INSERT INTO business_audit(actor_id, subject, record_id, action, occurred_at, details) VALUES (?, ?, ?, ?, ?, ?)
  `, actorId, subject, recordId, action, now, JSON.stringify(details));
}

export function nextWorkingDay(date, weekOff, holidays, leaves) {
  for (let offset = 1; offset <= 366; offset++) {
    const candidate = studioDay(dayStart(date) + offset * dayLength);
    if (weekday(candidate) !== weekOff && !holidays.has(candidate) && !leaves.some((leave) =>
      leave.leave_type !== 'half' && candidate >= leave.day_from && candidate <= leave.day_to)) return candidate;
  }
  return null;
}

export function refreshStudioNotices(db, now = Date.now()) {
  const today = studioDay(now);
  const start = dayStart(today);
  return db.transaction(async (store) => {
    const settings = await settingsAt(store, today);
    await store.run(`
      INSERT INTO operation_notices(employee_id, event_key, title, message, task_id, created_at)
      SELECT task_assignments.employee_id, 'finish:' || tasks.id || ':' || (tasks.start_at + 60000 * tasks.estimate),
             'Task finishes soon', tasks.title, tasks.id, ?
      FROM tasks JOIN task_assignments ON tasks.id = task_assignments.task_id
      JOIN employees ON employees.id = task_assignments.employee_id
      WHERE tasks.completed_at IS NULL AND tasks.shoot_status = 'booked' AND tasks.work_state = 'ready' AND tasks.is_unscheduled = 0
        AND employees.archived = 0 AND employees.deactivated = 0
        AND tasks.start_at + 60000 * tasks.estimate > ? AND tasks.start_at + 60000 * tasks.estimate <= ?
      ON CONFLICT(employee_id, event_key) DO NOTHING
    `, now, now, now + settings.task_reminder_minutes * minute);
    await store.run(`
      INSERT INTO operation_notices(employee_id, event_key, title, message, task_id, created_at)
      SELECT task_assignments.employee_id, 'overdue:' || tasks.id || ':' || (tasks.start_at + 60000 * tasks.estimate),
             'Task overdue', tasks.title, tasks.id, ?
      FROM tasks JOIN task_assignments ON tasks.id = task_assignments.task_id
      JOIN employees ON employees.id = task_assignments.employee_id
      WHERE tasks.completed_at IS NULL AND tasks.shoot_status = 'booked' AND tasks.work_state = 'ready' AND tasks.is_unscheduled = 0
        AND employees.archived = 0 AND employees.deactivated = 0
        AND tasks.start_at + 60000 * tasks.estimate BETWEEN ? AND ?
      ON CONFLICT(employee_id, event_key) DO NOTHING
    `, now, start, now);
    const activeBreaks = await store.all(`
      SELECT p.* FROM work_periods p JOIN employees e ON e.id = p.employee_id
      WHERE p.kind != 'travel' AND p.end_at IS NULL AND p.start_at <= ? AND e.archived = 0 AND e.deactivated = 0
    `, now);
    for (const period of activeBreaks) {
      const lunch = period.kind === 'lunch';
      const deadline = period.start_at + (lunch ? settings.lunch_minutes : settings.personal_break_minutes) * minute;
      if (now >= deadline) {
        await notify(store, period.employee_id, 'break-overrun:' + period.id, 'Break running longer than planned',
          'Close the timer when you return to work.', now);
      } else if (lunch && now >= deadline - 5 * minute) {
        await notify(store, period.employee_id, 'lunch-last-five:' + period.id, 'Lunch ends in five minutes',
          'End your lunch timer when you return.', now);
      }
    }
    const holidays = new Set((await store.all('SELECT day FROM holidays WHERE day >= ?', today)).map((row) => row.day));
    if (weekday(today) === settings.week_off || holidays.has(today)) return;
    const lunch = settings.lunch_start && Date.parse(today + 'T' + settings.lunch_start + ':00+05:30');
    if (lunch && now >= lunch - 5 * minute && now < lunch + settings.lunch_minutes * minute) {
      const started = now >= lunch;
      await store.run(`
        INSERT INTO operation_notices(employee_id, event_key, title, message, created_at)
        SELECT e.id, ?, ?, ?, ? FROM employees e JOIN attendance a ON a.employee_id = e.id AND a.clock_out IS NULL
        WHERE e.archived = 0 AND e.deactivated = 0 AND NOT EXISTS (
          SELECT 1 FROM work_periods p WHERE p.employee_id = e.id AND p.kind = 'lunch' AND p.start_at >= ?
        )
        ON CONFLICT(employee_id, event_key) DO NOTHING
      `, (started ? 'scheduled-lunch:' : 'before-lunch:') + today, started ? 'Scheduled lunch has started' : 'Lunch starts in five minutes',
      started ? 'Start the lunch timer when you take your break.' : 'Plan to pause your current task.', now, start);
    }
    const opens = Date.parse(today + 'T' + (settings.work_start || '09:00') + ':00+05:30');
    if (now >= opens) {
      await store.run(`
        INSERT INTO operation_notices(employee_id, event_key, title, message, created_at)
        SELECT admin.id, 'unassigned:' || staff.id || ':' || ?, 'Employee has no scheduled work', staff.name, ?
        FROM employees staff CROSS JOIN employees admin
        WHERE staff.is_admin = 0 AND staff.archived = 0 AND staff.deactivated = 0 AND staff.password_hash IS NOT NULL
          AND (staff.employment_start IS NULL OR staff.employment_start <= ?)
          AND admin.is_admin = 1 AND admin.archived = 0 AND admin.deactivated = 0
          AND NOT EXISTS (
            SELECT 1 FROM hr_requests h WHERE h.employee_id = staff.id AND h.kind = 'leave' AND h.status = 'approved'
              AND h.leave_type != 'half' AND h.day_from <= ? AND h.day_to >= ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM task_assignments a JOIN tasks t ON t.id = a.task_id
            WHERE a.employee_id = staff.id AND t.shoot_status = 'booked' AND t.work_state = 'ready'
              AND (t.is_unscheduled = 1 OR (t.start_at < ? AND t.start_at + 60000 * t.estimate > ?))
          )
        ON CONFLICT(employee_id, event_key) DO NOTHING
      `, today, now, today, today, today, start + dayLength, start);
    }
    const deadline = Date.parse(today + 'T' + settings.plan_deadline + ':00+05:30');
    if (now < deadline - 20 * minute) return;
    const staff = await store.all('SELECT id, name FROM employees WHERE is_admin = 0 AND archived = 0 AND deactivated = 0 AND password_hash IS NOT NULL AND (employment_start IS NULL OR employment_start <= ?)', today);
    const late = now >= deadline;
    for (const person of staff) {
      const leaves = await store.all("SELECT day_from, day_to, leave_type FROM hr_requests WHERE employee_id = ? AND kind = 'leave' AND status = 'approved' AND day_to >= ?", person.id, today);
      if (leaves.some((leave) => leave.leave_type !== 'half' && leave.day_from <= today && leave.day_to >= today)) continue;
      const next = nextWorkingDay(today, settings.week_off, holidays, leaves);
      if (!next || await store.get("SELECT 1 FROM daily_plans WHERE employee_id = ? AND work_day = ? AND status IN ('submitted', 'approved')", person.id, next)) continue;
      await notify(store, person.id, (late ? 'late-next:' : 'next:') + next, late ? 'Daily plan overdue' : 'Daily plan due soon', 'Submit your plan for ' + next + ' by ' + settings.plan_deadline + ' IST.', now);
      if (late) await notifyAdmins(store, 'late-next:' + person.id + ':' + next, 'Employee plan overdue', person.name + ' · ' + next, now);
    }
  });
}
