import { isFileIdentifier } from './local-files.js';
import { notify, notifyAdmins, recordBusinessAudit } from './studio-notices.js';

export function createFootage(db, { RequestError, idValue, text, optional }) {
  const adminOnly = (actor) => {
    if (!actor.is_admin) throw new RequestError('This action is available to the administrator only.', 403);
  };

  async function assign(store, check, person, title, actorId, now) {
    if (check.assigned_to === person && check.task_id) return check;
    const task = check.task_id
      ? await store.get('UPDATE tasks SET employee_id = ? WHERE id = ? RETURNING id', person, check.task_id)
      : await store.get(`
        INSERT INTO tasks(title, employee_id, start_at, estimate, location, category, priority)
        VALUES (?, ?, ?, 30, 'Storage', 'Studio', 1) RETURNING id
      `, ('Verify footage · ' + title).slice(0, 100), person, now);
    if (check.task_id) await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND end_at IS NULL', now, task.id);
    const row = await store.get(`
      UPDATE footage_checks SET assigned_to = ?, task_id = ?, status = CASE WHEN status = 'unassigned' THEN 'assigned' ELSE status END
      WHERE id = ? RETURNING *
    `, person, task.id, check.id);
    await recordBusinessAudit(store, actorId, 'footage', check.id, 'storage assigned', now, { employeeId: person, previousEmployeeId: check.assigned_to });
    await notify(store, person, 'footage:' + check.id + ':' + now, 'Footage verification assigned', title, now, task.id);
    return row;
  }

  async function onShootCompleted(store, shoot, actorId, now) {
    const check = await store.get(`
      INSERT INTO footage_checks(shoot_id, created_at) VALUES (?, ?) ON CONFLICT(shoot_id) DO NOTHING RETURNING *
    `, shoot.id, now);
    if (!check) return;
    await recordBusinessAudit(store, actorId, 'footage', check.id, 'verification created', now, { shootId: shoot.id });
    const manager = await store.get(`
      SELECT e.id FROM hr_settings h JOIN employees e ON e.id = h.storage_manager_id
      WHERE h.id = 1 AND e.is_admin = 0 AND e.archived = 0 AND e.deactivated = 0 AND e.password_hash IS NOT NULL
    `);
    if (manager) await assign(store, check, manager.id, shoot.title, actorId, now);
    else await notifyAdmins(store, 'footage-unassigned:' + check.id, 'Footage verification needs an assignee', shoot.title, now, shoot.id);
  }

  function assignManager(body, actor, now) {
    adminOnly(actor);
    const person = body.employeeId == null || body.employeeId === '' ? null : idValue(body.employeeId);
    if (person == null && body.employeeId != null && body.employeeId !== '') throw new RequestError('Choose an active employee.');
    return db.transaction(async (store) => {
      if (person && !await store.get('SELECT 1 FROM employees WHERE id = ? AND is_admin = 0 AND deactivated = 0 AND archived = 0 AND password_hash IS NOT NULL', person)) {
        throw new RequestError('Choose an active employee with credentials.');
      }
      const before = await store.get('SELECT storage_manager_id FROM hr_settings WHERE id = 1');
      await store.run('UPDATE hr_settings SET storage_manager_id = ? WHERE id = 1', person);
      if (person) {
        const pending = await store.all(`
          SELECT f.*, t.title AS shoot_title FROM footage_checks f JOIN tasks t ON t.id = f.shoot_id
          WHERE f.status IN ('unassigned','assigned','returned','incident') AND (f.assigned_to IS NULL OR f.assigned_to != ?)
        `, person);
        for (const check of pending) await assign(store, check, person, check.shoot_title, actor.id, now);
      }
      await recordBusinessAudit(store, actor.id, 'storage policy', 1, 'manager updated', now, { before: before.storage_manager_id, employeeId: person });
      return { employeeId: person };
    });
  }

  async function get(store, id, actor) {
    const check = await store.get('SELECT * FROM footage_checks WHERE id = ?', idValue(id));
    if (!check || (!actor.is_admin && check.assigned_to !== actor.id)) throw new RequestError('Footage verification not found.', 404);
    return check;
  }

  function submit(body, actor, now) {
    return db.transaction(async (store) => {
      const check = await get(store, body.id, actor);
      if (check.assigned_to !== actor.id || !['assigned','returned','incident'].includes(check.status)) {
        throw new RequestError('Only the assigned manager can submit this verification.', 409);
      }
      const incident = optional(body.incident, 'incident type', 20);
      if (incident && !['missing','corrupted'].includes(incident)) throw new RequestError('Choose missing or corrupted footage.');
      const note = incident ? text(body.note, 'incident notes', 1000) : optional(body.note, 'storage notes', 1000);
      const drive = incident ? optional(body.drive, 'storage drive', 100) : text(body.drive, 'storage drive', 100);
      const folder = incident ? optional(body.folder, 'folder path', 400) : text(body.folder, 'folder path', 400);
      const backup = incident ? optional(body.backup, 'backup location', 400) : text(body.backup, 'backup location', 400);
      const screenshot = body.screenshotId || null;
      if (screenshot && (!isFileIdentifier(screenshot) || !await store.get(`
        SELECT 1 FROM private_files WHERE kind = 'task' AND record_id = ? AND id = ?
          AND media_type IN ('image/png','image/jpeg') AND removed_at IS NULL
      `, check.task_id, screenshot))) throw new RequestError('Choose a screenshot attached to this verification.');
      const transferred = Number(body.transferred === true);
      const stored = Number(body.stored === true);
      if (!incident && (!transferred || !stored || !screenshot)) throw new RequestError('Confirm transfer and storage, then attach a screenshot.');
      const status = incident ? 'incident' : 'submitted';
      await store.run('UPDATE task_sessions SET end_at = ? WHERE task_id = ? AND end_at IS NULL', now, check.task_id);
      await store.run("UPDATE tasks SET work_state = ?, completion_file_id = ? WHERE id = ?", 'review', screenshot, check.task_id);
      const updated = await store.get(`
        UPDATE footage_checks SET status = ?, transferred = ?, stored = ?, drive = ?, folder = ?, backup = ?, incident = ?,
          note = ?, screenshot_id = ?, submitted_at = ?, reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
        WHERE id = ? RETURNING *
      `, status, transferred, stored, drive, folder, backup, incident, note, screenshot, now, check.id);
      await recordBusinessAudit(store, actor.id, 'footage', check.id, status, now, { drive, folder, backup, incident, screenshot });
      const title = (await store.get('SELECT title FROM tasks WHERE id = ?', check.shoot_id)).title;
      await notifyAdmins(store, 'footage-submitted:' + check.id + ':' + now,
        incident ? 'Footage incident reported' : 'Footage awaiting approval', title, now, check.task_id);
      return updated;
    });
  }

  function review(body, actor, now) {
    adminOnly(actor);
    if (!['approved','returned'].includes(body.status)) throw new RequestError('Choose approve or return.');
    const note = body.status === 'returned' ? text(body.note, 'review note', 1000) : optional(body.note, 'review note', 1000);
    return db.transaction(async (store) => {
      const item = await get(store, body.id, actor);
      if (!(item.status === 'submitted' || (item.status === 'incident' && body.status === 'returned'))) {
        throw new RequestError('This verification is unavailable for that review.', 409);
      }
      if (item.assigned_to === actor.id && body.status === 'approved') throw new RequestError('Another administrator must review your own verification.', 403);
      await store.run("UPDATE tasks SET work_state = 'ready', completed_at = ? WHERE id = ?", body.status === 'approved' ? now : null, item.task_id);
      const row = await store.get(`
        UPDATE footage_checks SET status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? RETURNING *
      `, body.status, note, now, actor.id, item.id);
      await recordBusinessAudit(store, actor.id, 'footage', item.id, row.status, now, { note, screenshot: item.screenshot_id });
      await notify(store, item.assigned_to, 'footage-reviewed:' + item.id + ':' + now, 'Footage verification ' + row.status,
        note || 'Open footage storage to view the verification.', now, item.task_id);
      return row;
    });
  }

  async function snapshot(actor) {
    const checks = await db.all(`
      SELECT f.*, s.title AS shoot_title, s.start_at AS shoot_at, s.location AS shoot_location,
        s.client_id, c.name AS client_name, c.phone AS client_phone, e.name AS manager_name
      FROM footage_checks f JOIN tasks s ON s.id = f.shoot_id
      LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN employees e ON e.id = f.assigned_to
      ${actor.is_admin ? '' : 'WHERE f.assigned_to = ?'}
      ORDER BY f.status = 'approved', f.created_at DESC
    `, ...(actor.is_admin ? [] : [actor.id]));
    return { footageChecks: checks };
  }

  return { snapshot, onShootCompleted, assignManager, submit, review };
}
