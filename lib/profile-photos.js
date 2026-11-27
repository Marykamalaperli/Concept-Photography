import { recordBusinessAudit } from './studio-notices.js';

export function installProfilePhotos(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE employees ADD COLUMN active_photo_id TEXT REFERENCES private_files(id);
      PRAGMA user_version = 23;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setProfilePhoto(store, actor, employeeId, fileId, now, RequestError) {
  return store.transaction(async (tx) => {
    if (!employeeId || (!actor.is_admin && employeeId !== actor.id)) throw new RequestError('Employee not found.', 404);
    const subject = await tx.get('SELECT id, active_photo_id FROM employees WHERE id = ? AND archived = 0', employeeId);
    if (!subject) throw new RequestError('Employee not found.', 404);
    if (fileId !== null && !await tx.get(`
      SELECT 1 FROM private_files WHERE id = ? AND kind = 'profile' AND record_id = ?
        AND media_type IN ('image/jpeg','image/png') AND removed_at IS NULL
    `, fileId, employeeId)) throw new RequestError('Profile photo not found.', 404);
    if (subject.active_photo_id !== fileId) {
      await tx.run('UPDATE employees SET active_photo_id = ? WHERE id = ?', fileId, employeeId);
      await recordBusinessAudit(tx, actor.id, 'employee', employeeId, 'profile photo changed', now, { before: subject.active_photo_id, after: fileId });
    }
    return { active_photo_id: fileId };
  });
}

export function activeProfilePhoto(db, actor, employeeId, fileId) {
  return db.get(`
    SELECT f.* FROM employees e JOIN private_files f ON f.id = e.active_photo_id
      AND f.kind = 'profile' AND f.record_id = e.id AND f.removed_at IS NULL
      AND f.media_type IN ('image/jpeg','image/png')
    WHERE e.id = ? AND f.id = ? AND e.archived = 0
      AND (? OR e.id = ? OR EXISTS (
        SELECT 1 FROM task_assignments a JOIN task_assignments b ON b.task_id = a.task_id
        WHERE a.employee_id = ? AND b.employee_id = e.id
      ))
  `, employeeId, fileId, Number(actor.is_admin), actor.id, actor.id);
}
