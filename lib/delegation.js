import { recordBusinessAudit } from './studio-notices.js';

export const staffRoles = ['Photographer', 'Videographer', 'Video Editor', 'Photo Editor', 'Data Storage Manager', 'Studio Assistant', 'General Employee'];
export const permissions = ['review-plans', 'review-tasks', 'review-attendance', 'review-footage'];
export const can = (actor, permission) => Boolean(actor?.is_admin || actor?.permissions?.includes(permission));

export function installDelegationSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE employees ADD COLUMN permission_role TEXT NOT NULL DEFAULT 'General Employee';
      CREATE TABLE role_permissions (
        role TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(role, permission)
      ) STRICT;
      PRAGMA user_version = 17;
    `);
    const assign = db.prepare("UPDATE employees SET permission_role = ? WHERE is_admin = 0 AND role = ? COLLATE NOCASE");
    for (const role of staffRoles) assign.run(role, role);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createDelegation(db, { RequestError, idValue }) {
  function adminOnly(actor) {
    if (!actor.is_admin) throw new RequestError('Only an administrator can manage access.', 403);
  }
  function roleMatrix(actor) {
    adminOnly(actor);
    return db.all('SELECT role, permission FROM role_permissions ORDER BY role, permission');
  }

  function save(body, actor, now) {
    adminOnly(actor);
    if (!staffRoles.includes(body.role) || !Array.isArray(body.permissions) || body.permissions.some((item) => !permissions.includes(item)) ||
        body.permissions.length > permissions.length) throw new RequestError('Choose a staff role and valid permissions.');
    return db.transaction(async (store) => {
      const before = await store.all('SELECT permission FROM role_permissions WHERE role = ?', body.role);
      await store.run('DELETE FROM role_permissions WHERE role = ?', body.role);
      const after = [...new Set(body.permissions)];
      for (const key of after) await store.run('INSERT INTO role_permissions(role, permission) VALUES (?, ?)', body.role, key);
      await recordBusinessAudit(store, actor.id, 'roles', 0, 'permissions updated', now,
        { role: body.role, before: before.map((row) => row.permission), after });
      return { ok: true };
    });
  }

  function assign(body, actor, now) {
    adminOnly(actor);
    if (!staffRoles.includes(body.role)) throw new RequestError('Choose an access role.');
    return db.transaction(async (store) => {
      const subject = await store.get('SELECT id, permission_role FROM employees WHERE id = ? AND is_admin = 0 AND archived = 0', idValue(body.employeeId));
      if (!subject) throw new RequestError('Employee not found.', 404);
      await store.run('UPDATE employees SET permission_role = ? WHERE id = ?', body.role, subject.id);
      await recordBusinessAudit(store, actor.id, 'employee role', subject.id, 'access role changed', now,
        { before: subject.permission_role, after: body.role });
      return { ok: true };
    });
  }

  async function queue(actor) {
    const plan = can(actor, 'review-plans');
    const task = can(actor, 'review-tasks');
    const attendance = can(actor, 'review-attendance');
    const footage = can(actor, 'review-footage');
    if (!plan && !task && !attendance && !footage) throw new RequestError('No review permissions are assigned.', 403);
    const [plans, changes, completions, shifts, requests, storage] = await Promise.all([
      plan ? db.all(`
        SELECT p.id, p.work_day, p.entries, p.reason, e.name FROM daily_plans p JOIN employees e ON e.id = p.employee_id
        WHERE p.status = 'submitted' AND p.employee_id != ? ORDER BY p.work_day, p.id LIMIT 100
      `, actor.id) : [],
      task ? db.all(`
        SELECT c.id, c.kind, c.reason, c.minutes, c.proposed_start, staff.name, proposed.name AS proposed_name, t.title
        FROM task_changes c JOIN employees staff ON staff.id = c.employee_id JOIN tasks t ON t.id = c.task_id
        LEFT JOIN employees proposed ON proposed.id = c.proposed_employee WHERE c.status = 'pending'
          AND c.employee_id != ? AND t.employee_id != ? AND COALESCE(c.proposed_employee, 0) != ? ORDER BY c.requested_at LIMIT 100
      `, actor.id, actor.id, actor.id) : [],
      task ? db.all(`
        SELECT t.id, t.title, t.completion_report, t.completion_file_id, e.name FROM tasks t JOIN employees e ON e.id = t.employee_id
        WHERE t.employee_id != ? AND t.work_state = 'review' AND NOT EXISTS (SELECT 1 FROM footage_checks WHERE task_id = t.id)
        ORDER BY t.id LIMIT 100
      `, actor.id) : [],
      attendance ? db.all(`
        SELECT s.*, e.name FROM shift_reviews s JOIN employees e ON e.id = s.employee_id
        WHERE s.employee_id != ? AND s.status = 'pending' ORDER BY s.ended_at LIMIT 100
      `, actor.id) : [],
      attendance ? db.all(`
        SELECT r.id, r.kind, r.leave_type, r.day_from, r.day_to, r.clock_in, r.clock_out, r.reason, e.name
        FROM hr_requests r JOIN employees e ON e.id = r.employee_id
        WHERE r.status = 'pending' AND r.employee_id != ? ORDER BY r.requested_at LIMIT 100
      `, actor.id) : [],
      footage ? db.all(`
        SELECT f.id, f.status, f.drive, f.folder, f.backup, f.note, f.screenshot_id, s.title, e.name
        FROM footage_checks f JOIN tasks s ON s.id = f.shoot_id JOIN employees e ON e.id = f.assigned_to
        WHERE f.assigned_to != ? AND f.status IN ('submitted','incident') ORDER BY f.submitted_at LIMIT 100
      `, actor.id) : [],
    ]);
    return { plans, changes, completions, shifts, requests, storage };
  }

  return { roleMatrix, save, assign, queue };
}
