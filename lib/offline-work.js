import { constants, createDecipheriv, createHash, privateDecrypt } from 'node:crypto';
import { isFileIdentifier } from './local-files.js';

export function installOfflineWork(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE personal_notes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE daily_plans ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tasks ADD COLUMN work_revision INTEGER NOT NULL DEFAULT 1;
      CREATE TRIGGER task_work_revision AFTER UPDATE OF employee_id, start_at, estimate, work_state, shoot_status, completed_at, title, location ON tasks
      WHEN OLD.employee_id IS NOT NEW.employee_id OR OLD.start_at IS NOT NEW.start_at OR OLD.estimate IS NOT NEW.estimate OR
        OLD.work_state IS NOT NEW.work_state OR OLD.shoot_status IS NOT NEW.shoot_status OR OLD.completed_at IS NOT NEW.completed_at OR
        OLD.title IS NOT NEW.title OR OLD.location IS NOT NEW.location
      BEGIN
        UPDATE tasks SET work_revision = work_revision + 1 WHERE id = NEW.id;
      END;
      CREATE TABLE task_private_drafts (
        employee_id INTEGER NOT NULL REFERENCES employees(id), task_id INTEGER NOT NULL REFERENCES tasks(id),
        progress TEXT NOT NULL, completion TEXT NOT NULL, updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL, PRIMARY KEY(employee_id, task_id)
      ) STRICT;
      CREATE TABLE offline_work_submissions (
        employee_id INTEGER NOT NULL REFERENCES employees(id), id TEXT NOT NULL,
        command_hash TEXT NOT NULL, received_at INTEGER NOT NULL, record_id INTEGER, record_version INTEGER,
        PRIMARY KEY(employee_id, id)
      ) STRICT;
      PRAGMA user_version = 26;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const maxAge = 7 * 86_400_000;
export const offlineWorkPaths = ['profile/notes', 'hr/work-logs', 'hr/requests', 'operations/plan', 'task-draft'];

function decode(value, min, max = min) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== value) throw new Error();
  return bytes;
}

export function createOfflineWork(db, operations, hr, { RequestError, idValue, optional }) {
  async function saveNote(store, body, actor, now) {
    const value = optional(body.note, 'note', 6000) ?? '';
    const current = await store.get('SELECT version FROM personal_notes WHERE employee_id = ?', actor.id);
    if ((current?.version ?? 0) !== Number(body.version ?? 0)) {
      throw new RequestError('The notepad has changed. Open the latest note before saving again.', 409);
    }
    return store.get(`INSERT INTO personal_notes(employee_id, note, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at, version = version + 1
      RETURNING employee_id AS id, version`, actor.id, value, now);
  }

  async function saveTaskDraft(store, body, actor, now) {
    const task = await store.get(`SELECT t.id, work_revision FROM tasks t JOIN task_assignments a ON a.task_id = t.id
      WHERE t.id = ? AND a.employee_id = ? AND t.category != 'Photo shoot' AND t.shoot_status = 'booked'
        AND t.work_state = 'ready' AND t.completed_at IS NULL AND t.is_open = 0`, idValue(body.taskId), actor.id);
    if (!task || task.work_revision !== Number(body.taskVersion)) {
      throw new RequestError('The task has changed. Open the latest task before saving a draft.', 409);
    }
    const current = await store.get('SELECT version FROM task_private_drafts WHERE employee_id = ? AND task_id = ?', actor.id, task.id);
    if ((current?.version ?? 0) !== Number(body.version ?? 0)) throw new RequestError('The task draft has changed.', 409);
    const progress = optional(body.progress, 'progress update', 2000) ?? '';
    const completion = optional(body.completion, 'completion draft', 1500) ?? '';
    return store.get(`INSERT INTO task_private_drafts(employee_id,task_id,progress,completion,updated_at,version) VALUES (?,?,?,?,?,1)
      ON CONFLICT(employee_id,task_id) DO UPDATE SET progress=excluded.progress,completion=excluded.completion,updated_at=excluded.updated_at,version=version+1
      RETURNING task_id AS id, version`, actor.id, task.id, progress, completion, now);
  }

  async function openEnvelope(body, actor) {
    const keys = await db.get('SELECT private_key FROM offline_encryption WHERE id = 1');
    let command;
    let fingerprint;
    try {
      const wrapped = decode(body.wrappedKey, 256);
      const unwrapped = privateDecrypt({ key: keys.private_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped);
      const encrypted = decode(body.ciphertext, 17, 22_000);
      const decipher = createDecipheriv('aes-256-gcm', unwrapped, decode(body.iv, 12));
      decipher.setAuthTag(encrypted.subarray(-16));
      const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
      command = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
      fingerprint = createHash('sha256').update(plain).digest('hex');
    } catch {
      throw new RequestError('The encrypted update could not be opened.');
    }
    if (command?.employeeId !== actor.id) throw new RequestError('This saved update belongs to a different account.', 403);
    const { id, createdAt, path, data } = command;
    if (!isFileIdentifier(id) || !offlineWorkPaths.includes(path) || !data || Array.isArray(data) || typeof data !== 'object' || !Number.isSafeInteger(createdAt)) {
      throw new RequestError('This saved update is invalid.');
    }
    return { id, createdAt, path, data, fingerprint };
  }

  async function synchronize(body, actor, now) {
    const { id, createdAt, path, data, fingerprint } = await openEnvelope(body, actor);
    if (createdAt > now + 60_000 || createdAt < now - maxAge) throw new RequestError('This saved update is too old or the device clock was incorrect.');
    return db.transaction(async (store) => {
      const current = await store.get('SELECT 1 FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0', actor.id);
      if (!current) throw new RequestError('This account can no longer send updates.', 403);
      const prior = await store.get('SELECT command_hash,record_id,record_version FROM offline_work_submissions WHERE employee_id = ? AND id = ?', actor.id, id);
      if (prior) {
        if (prior.command_hash !== fingerprint) throw new RequestError('This saved update ID has already been used.', 409);
        return { id: prior.record_id, version: prior.record_version };
      }
      let result;
      if (path === 'profile/notes') result = await saveNote(store, data, actor, now);
      if (path === 'hr/work-logs') result = await hr.log(data, actor, now, store);
      if (path === 'hr/requests') result = await hr.submit(data, actor, now, store);
      if (path === 'operations/plan') result = await operations.planDraft(data, actor, now, store, true);
      if (path === 'task-draft') result = await saveTaskDraft(store, data, actor, now);
      const version = result.draft_version ?? result.version ?? null;
      await store.run(`INSERT INTO offline_work_submissions(employee_id,id,command_hash,received_at,record_id,record_version) VALUES(?,?,?,?,?,?)`,
        actor.id, id, fingerprint, now, result.id, version);
      return { id: result.id, version };
    });
  }

  const drafts = (actor) => db.all(`SELECT d.* FROM task_private_drafts d JOIN task_assignments a ON a.task_id = d.task_id AND a.employee_id = d.employee_id
    JOIN tasks t ON t.id = d.task_id WHERE d.employee_id = ? AND t.completed_at IS NULL AND t.shoot_status = 'booked'`, actor.id);

  return {
    synchronize, saveNote, saveTaskDraft, drafts,
    async recover(body, actor) {
      const { path, data } = await openEnvelope(body, actor);
      return { path, data };
    },
  };
}
