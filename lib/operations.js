import { can } from './delegation.js';
import { canReviewTaskRecord } from './scoped-access.js';
import { studioDay, validDay } from './hr-policy.js';
import { notify, notifyAdmins, recordBusinessAudit } from './studio-notices.js';

const minute = 60_000;

export function createOperations(db, { RequestError, idValue, text, optional }) {
  const adminOnly = (actor) => {
    if (!actor.is_admin) throw new RequestError('This action is available to the administrator only.', 403);
  };

  async function findPlan(store, id, actor, otherEmployee = false) {
    const plan = await store.get('SELECT * FROM daily_plans WHERE id = ?', idValue(id));
    if (!plan || (!actor.is_admin && !otherEmployee && plan.employee_id !== actor.id)) throw new RequestError('Daily plan not found.', 404);
    return plan;
  }

  function planDraft(body, actor, now, transaction, checkVersion = false) {
    const date = body.date;
    if (!validDay(date) || date < studioDay(now)) throw new RequestError('Choose today or a future working date.');
    if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > 20) {
      throw new RequestError('Add 1 to 20 tasks to the plan.');
    }
    const currentTime = /^([01]\d|2[0-3]):[0-5]\d$/;
    const entries = body.entries.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new RequestError('Enter a valid plan task.');
      const { title, location, from, to, category } = entry;
      if (!currentTime.test(from) || !currentTime.test(to) || from >= to) throw new RequestError('Enter ordered start and end times.');
      if (!['Editing', 'Planning', 'Studio', 'Other'].includes(category)) throw new RequestError('Choose a valid work category.');
      return { title: text(title, 'task title'), location: text(location, 'location'), from, to, category,
        start: Date.parse(date + 'T' + from + ':00+05:30'), end: Date.parse(date + 'T' + to + ':00+05:30') };
    }).sort((a, b) => a.start - b.start);
    if (entries.some((entry, index) => index && entries[index - 1].end > entry.start)) {
      throw new RequestError('Tasks in one plan cannot overlap.');
    }
    const apply = async (store) => {
      const current = await store.get("SELECT * FROM daily_plans WHERE employee_id = ? AND work_day = ? AND status IN ('draft', 'submitted')", actor.id, date);
      if (current?.status === 'submitted') throw new RequestError('This plan is awaiting review.', 409);
      if ((current?.id ?? null) !== idValue(body.id)) throw new RequestError('This plan changed. Reopen it before saving.', 409);
      if ((checkVersion || body.version !== undefined) && (current?.draft_version ?? 0) !== Number(body.version)) {
        throw new RequestError('This plan draft has changed. Open the latest draft before saving again.', 409);
      }
      const previous = await store.get("SELECT id FROM daily_plans WHERE employee_id = ? AND work_day = ? AND status = 'approved'", actor.id, date);
      const reason = previous ? text(body.reason, 'reason for changing the approved plan', 600) : null;
      if (current) return store.get('UPDATE daily_plans SET entries = ?, reason = ?, draft_version = draft_version + 1 WHERE id = ? RETURNING *',
        JSON.stringify(entries), reason, current.id);
      const { revision } = await store.get('SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM daily_plans WHERE employee_id = ? AND work_day = ?', actor.id, date);
      return store.get(`
        INSERT INTO daily_plans(employee_id, work_day, revision, previous_id, status, entries, reason, created_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?) RETURNING *
      `, actor.id, date, revision, previous?.id ?? null, JSON.stringify(entries), reason, now);
    };
    return transaction ? apply(transaction) : db.transaction(apply);
  }

  function submitPlan(body, actor, now) {
    return db.transaction(async (store) => {
      const plan = await findPlan(store, body.id, actor);
      if (plan.employee_id !== actor.id || plan.status !== 'draft' || plan.work_day < studioDay(now)) {
        throw new RequestError('Only your current or future draft can be submitted.', 409);
      }
      const result = await store.get("UPDATE daily_plans SET status = 'submitted', submitted_at = ? WHERE id = ? RETURNING *", now, plan.id);
      await recordBusinessAudit(store, actor.id, 'daily plan', plan.id, 'submitted', now);
      await notifyAdmins(store, 'plan-submitted:' + plan.id, 'Daily plan awaiting review', actor.name + ' · ' + plan.work_day, now);
      return result;
    });
  }

  async function conflict(store, employeeId, start, end, { taskId = null, previousPlan = null } = {}) {
    return store.get(`
      SELECT t.id, t.title FROM task_assignments a JOIN tasks t ON t.id = a.task_id
      WHERE a.employee_id = ? AND t.shoot_status = 'booked' AND t.work_state = 'ready' AND t.is_unscheduled = 0 AND t.completed_at IS NULL
        AND (? IS NULL OR t.id != ?) AND (? IS NULL OR t.daily_plan_id IS NOT ?)
        AND t.start_at < ? AND t.start_at + 60000 * t.estimate > ? LIMIT 1
    `, employeeId, taskId, taskId, previousPlan, previousPlan, end, start);
  }

  function reviewPlan(body, actor, now) {
    if (!can(actor, 'review-plans')) throw new RequestError('You do not have permission to review plans.', 403);
    const status = body.decision;
    if (!['approved', 'rejected'].includes(status)) throw new RequestError('Choose approve or reject.');
    const note = status === 'rejected' ? text(body.note, 'review reason', 600) : optional(body.note, 'review note', 600);
    return db.transaction(async (store) => {
      const plan = await findPlan(store, body.id, actor, true);
      if (!actor.is_admin && plan.employee_id === actor.id) throw new RequestError('Another reviewer must review your plan.', 403);
      if (plan.status !== 'submitted') throw new RequestError('This plan is no longer pending.', 409);
      if (status === 'approved') {
        if (plan.work_day < studioDay(now) || !await store.get('SELECT 1 FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0', plan.employee_id)) {
          throw new RequestError('The date has passed or the employee is inactive.', 409);
        }
        if (plan.previous_id && await store.get(`
          SELECT 1 FROM tasks WHERE daily_plan_id = ? AND (completed_at IS NOT NULL OR work_state != 'ready'
            OR EXISTS (SELECT 1 FROM task_sessions WHERE task_id = tasks.id))
        `, plan.previous_id)) throw new RequestError('Request changes to individual tasks after work has started.', 409);
        const entries = JSON.parse(plan.entries);
        for (const entry of entries) {
          const overlap = await conflict(store, plan.employee_id, entry.start, entry.end, { previousPlan: plan.previous_id });
          if (overlap) throw new RequestError(actor.is_admin ? 'Resolve the overlap with ' + overlap.title + ' before approval.' :
            'An existing assignment overlaps this time. Ask the administrator to resolve it before approval.', 409);
        }
        if (plan.previous_id) {
          await store.run("UPDATE daily_plans SET status = 'superseded' WHERE id = ?", plan.previous_id);
          await store.run("UPDATE tasks SET shoot_status = 'cancelled' WHERE daily_plan_id = ?", plan.previous_id);
        }
        for (const entry of entries) {
          await store.run(`
            INSERT INTO tasks(title, employee_id, start_at, estimate, location, category, daily_plan_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, entry.title, plan.employee_id, entry.start, (entry.end - entry.start) / minute, entry.location, entry.category, plan.id);
        }
      }
      const row = await store.get(`
        UPDATE daily_plans SET status = ?, decided_by = ?, decided_at = ?, review_note = ? WHERE id = ? RETURNING *
      `, status, actor.id, now, note, plan.id);
      await recordBusinessAudit(store, actor.id, 'daily plan', plan.id, status, now);
      await notify(store, plan.employee_id, 'plan-reviewed:' + plan.id, 'Daily plan ' + status, plan.work_day + (note ? ' · ' + note : ''), now);
      return row;
    });
  }

  async function findTask(store, id, actor, otherEmployee = false) {
    const task = await store.get('SELECT * FROM tasks WHERE id = ?', idValue(id));
    if (!task || (!actor.is_admin && !otherEmployee && !await store.get('SELECT 1 FROM task_assignments WHERE task_id = ? AND employee_id = ?', task.id, actor.id))) {
      throw new RequestError('Task not found.', 404);
    }
    return task;
  }

  function requestTaskChange(body, actor, now) {
    const kind = body.kind;
    const reason = text(body.reason, 'reason', 600);
    const start = kind === 'reschedule' ? Date.parse(body.start) : null;
    const minutes = kind === 'extension' ? Number(body.minutes) : null;
    const employee = kind === 'reassign' ? idValue(body.employeeId) : null;
    if (!['extension', 'reschedule', 'reassign'].includes(kind) ||
        (kind === 'reschedule' && (!Number.isFinite(start) || start < now)) ||
        (kind === 'extension' && (!Number.isInteger(minutes) || minutes < 1 || minutes > 480)) ||
        (kind === 'reassign' && !employee)) throw new RequestError('Provide a valid start time, extension or employee.');
    return db.transaction(async (store) => {
      const task = await findTask(store, body.taskId, actor);
      if (await store.get('SELECT 1 FROM footage_checks WHERE task_id = ?', task.id)) {
        throw new RequestError('Manage the assignee from Footage storage.', 409);
      }
      if (task.category === 'Photo shoot' || task.completed_at || task.shoot_status !== 'booked' || task.work_state === 'review') {
        throw new RequestError('This task cannot be changed here.', 409);
      }
      if (await store.get("SELECT 1 FROM task_changes WHERE task_id = ? AND status = 'pending'", task.id)) {
        throw new RequestError('A change request is already pending.', 409);
      }
      if (employee && !await store.get('SELECT 1 FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0 AND password_hash IS NOT NULL', employee)) {
        throw new RequestError('Choose an active employee.');
      }
      const row = await store.get(`
        INSERT INTO task_changes(task_id, employee_id, kind, reason, proposed_start, minutes, proposed_employee, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
      `, task.id, actor.id, kind, reason, start, minutes, employee, now);
      await recordBusinessAudit(store, actor.id, 'task change', row.id, 'requested', now, { taskId: task.id, kind });
      await notifyAdmins(store, 'change-request:' + row.id, 'Task change awaiting review', task.title, now, task.id);
      return row;
    });
  }

  function reviewTaskChange(body, actor, now) {
    if (!can(actor, 'review-tasks')) throw new RequestError('You do not have permission to review task changes.', 403);
    const status = body.decision;
    if (!['approved', 'rejected'].includes(status)) throw new RequestError('Choose approve or reject.');
    const note = status === 'rejected' ? text(body.note, 'review reason', 600) : optional(body.note, 'review note', 600);
    return db.transaction(async (store) => {
      const change = await store.get("SELECT * FROM task_changes WHERE id = ? AND status = 'pending'", idValue(body.id));
      if (!change) throw new RequestError('This request is no longer pending.', 409);
      const task = await findTask(store, change.task_id, actor, true);
      if (!await canReviewTaskRecord(store, actor, task.id)) throw new RequestError('Task change not found.', 404);
      if (!actor.is_admin && [change.employee_id, change.proposed_employee, task.employee_id].includes(actor.id)) {
        throw new RequestError('Another reviewer must review this change.', 403);
      }
      if (status === 'approved') {
        if (task.completed_at || task.shoot_status !== 'booked' || task.work_state === 'review') throw new RequestError('The task is no longer editable.', 409);
        const start = change.proposed_start ?? task.start_at;
        const estimate = task.estimate + (change.minutes ?? 0);
        const employeeId = change.proposed_employee ?? task.employee_id;
        const unscheduled = task.is_unscheduled && change.kind !== 'reschedule';
        if ((change.kind === 'reschedule' && start < now) || estimate > 1440 || (!unscheduled && start + estimate * minute <= now)) {
          throw new RequestError('Reject this request and submit a new timing.', 409);
        }
        if (!await store.get('SELECT 1 FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0 AND password_hash IS NOT NULL', employeeId)) {
          throw new RequestError('The proposed employee is unavailable.', 409);
        }
        const overlap = unscheduled ? null : await conflict(store, employeeId, start, start + estimate * minute, { taskId: task.id });
        if (overlap) throw new RequestError(actor.is_admin ? 'Resolve the overlap with ' + overlap.title + ' before approval.' :
          'An existing assignment overlaps this time. Ask the administrator to resolve it before approval.', 409);
        if (employeeId !== task.employee_id || change.kind === 'reschedule') {
          await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND end_at IS NULL', now, task.id);
        }
        await store.run(`
          UPDATE tasks SET start_at = ?, estimate = ?, employee_id = ?, work_state = 'ready', is_unscheduled = ?,
            acknowledged_at = CASE WHEN employee_id = ? THEN acknowledged_at ELSE NULL END WHERE id = ?
        `, start, estimate, employeeId, Number(unscheduled), employeeId, task.id);
        await store.run('DELETE FROM reminders WHERE task_id = ?', task.id);
        await recordBusinessAudit(store, actor.id, 'task', task.id, 'schedule changed', now, {
          previousStart: task.start_at, previousEstimate: task.estimate, previousEmployee: task.employee_id, start, estimate, employeeId,
        });
        if (employeeId !== task.employee_id) await notify(store, employeeId, 'reassigned:' + change.id, 'Task assigned', task.title, now, task.id);
      }
      await notify(store, change.employee_id, 'change-reviewed:' + change.id, 'Task change ' + status, task.title + (note ? ' · ' + note : ''), now, task.id);
      return store.get('UPDATE task_changes SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? RETURNING *',
        status, now, actor.id, note, change.id);
    });
  }

  function reviewCompletion(body, actor, now) {
    if (!can(actor, 'review-tasks')) throw new RequestError('You do not have permission to review completion reports.', 403);
    if (!['approve', 'return'].includes(body.decision)) throw new RequestError('Choose approve or return.');
    const note = body.decision === 'return' ? text(body.note, 'reason for returning the task', 600) : optional(body.note, 'review note', 600);
    return db.transaction(async (store) => {
      const task = await findTask(store, body.taskId, actor, true);
      if (!await canReviewTaskRecord(store, actor, task.id)) throw new RequestError('Task review not found.', 404);
      if (!actor.is_admin && task.employee_id === actor.id) throw new RequestError('Another reviewer must review this task.', 403);
      if (await store.get('SELECT 1 FROM footage_checks WHERE task_id = ?', task.id)) {
        throw new RequestError('Review the verification from Footage storage.', 409);
      }
      if (task.work_state !== 'review' || task.completed_at) throw new RequestError('This work is no longer awaiting review.', 409);
      const complete = body.decision === 'approve';
      const row = await store.get("UPDATE tasks SET work_state = 'ready', completed_at = ? WHERE id = ? RETURNING *", complete ? now : null, task.id);
      await recordBusinessAudit(store, actor.id, 'task', task.id, complete ? 'completion approved' : 'work returned', now, { note });
      await notify(store, task.employee_id, 'completion-reviewed:' + task.id + ':' + now, complete ? 'Task completion approved' : 'Task returned for changes',
        task.title + (note ? ' · ' + note : ''), now, task.id);
      return row;
    });
  }

  async function snapshot(actor) {
    const own = actor.is_admin ? [] : [actor.id];
    const [plans, taskChanges, notices, assignableStaff] = await Promise.all([
      db.all(`
        SELECT p.*, e.name AS employee_name FROM daily_plans p JOIN employees e ON e.id = p.employee_id
        ${actor.is_admin ? '' : 'WHERE p.employee_id = ?'}
        ORDER BY p.status = 'submitted' DESC, p.work_day DESC, p.revision DESC LIMIT 120
      `, ...own),
      db.all(`
        SELECT c.*, t.title, staff.name AS requested_by, assignee.name AS proposed_name
        FROM task_changes c JOIN tasks t ON t.id = c.task_id JOIN employees staff ON staff.id = c.employee_id
        LEFT JOIN employees assignee ON assignee.id = c.proposed_employee
        ${actor.is_admin ? '' : 'WHERE c.employee_id = ?'}
        ORDER BY c.status = 'pending' DESC, c.requested_at DESC LIMIT 120
      `, ...own),
      db.all('SELECT id, title, message, task_id, read_at, created_at FROM operation_notices WHERE employee_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', actor.id),
      db.all('SELECT id, name FROM employees WHERE archived = 0 AND deactivated = 0 AND password_hash IS NOT NULL ORDER BY name'),
    ]);
    return { plans, taskChanges, operationNotices: notices, assignableStaff };
  }

  return {
    snapshot, planDraft, submitPlan, reviewPlan, requestTaskChange, reviewTaskChange, reviewCompletion,
    readNotices: (actor, now) => db.run('UPDATE operation_notices SET read_at = ? WHERE employee_id = ? AND read_at IS NULL', now, actor.id),
    audit: (actor) => {
      adminOnly(actor);
      return db.all(`
        SELECT a.id, a.subject, a.record_id, a.action, a.details, a.occurred_at, e.name AS actor
        FROM business_audit a LEFT JOIN employees e ON e.id = a.actor_id ORDER BY a.id DESC LIMIT 100
      `);
    },
  };
}

export async function displaceEmergencyWork(store, shoot, recipients, actor, now) {
  const ids = recipients.map(() => '?').join(', ');
  const affected = await store.all(`
    SELECT DISTINCT t.* FROM tasks t JOIN task_assignments a ON a.task_id = t.id
    WHERE a.employee_id IN (${ids}) AND t.category != 'Photo shoot' AND t.shoot_status = 'booked'
      AND t.completed_at IS NULL AND t.work_state = 'ready' AND t.is_unscheduled = 0
      AND NOT EXISTS (SELECT 1 FROM footage_checks WHERE task_id = t.id)
      AND t.start_at < ? AND t.start_at + 60000 * t.estimate > ?
  `, ...recipients, shoot.start_at + shoot.estimate * minute, shoot.start_at);
  for (const task of affected) {
    await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND end_at IS NULL', now, task.id);
    await store.run("UPDATE tasks SET work_state = 'reschedule' WHERE id = ?", task.id);
    await store.run('DELETE FROM reminders WHERE task_id = ?', task.id);
    await recordBusinessAudit(store, actor.id, 'task', task.id, 'displaced by emergency shoot', now,
      { shootId: shoot.id, originalStart: task.start_at, originalEstimate: task.estimate });
    await notify(store, task.employee_id, 'displaced:' + shoot.id + ':' + task.id, 'Task needs rescheduling', task.title, now, task.id);
  }
  await notifyAdmins(store, 'emergency-admin:' + shoot.id, 'Emergency shoot assigned', shoot.title + ' · ' + affected.length + ' affected tasks', now, shoot.id);
  return affected;
}
