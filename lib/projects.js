import { projectAccessSql } from './project-access.js';
import { dayLength, studioDay } from './hr-policy.js';
import { isFileIdentifier } from './local-files.js';
import { recordBusinessAudit } from './studio-notices.js';

export function installProjectSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE payments ADD COLUMN category TEXT NOT NULL DEFAULT 'Shoot payment';
      ALTER TABLE clients ADD COLUMN postal_address TEXT;
      ALTER TABLE clients ADD COLUMN category TEXT;
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), name TEXT NOT NULL,
        category TEXT NOT NULL, description TEXT, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX client_projects ON projects(client_id, name);
      ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id);
      CREATE INDEX task_project ON tasks(project_id, start_at);
      CREATE TABLE project_resources (
        id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
        kind TEXT NOT NULL CHECK(kind IN ('document','reference','delivery')), title TEXT NOT NULL,
        url TEXT, file_id TEXT REFERENCES private_files(id), added_at INTEGER NOT NULL, removed_at INTEGER,
        CHECK((url IS NULL) != (file_id IS NULL))
      ) STRICT;
      CREATE INDEX project_resource_list ON project_resources(project_id, removed_at);
      PRAGMA user_version = 16;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createProjects(db, { RequestError, idValue, text, optional }) {
  const adminOnly = (actor) => {
    if (!actor.is_admin) throw new RequestError('This action is available to the administrator only.', 403);
  };

  function listed(actor) {
    return db.all(`
      SELECT p.id, p.client_id, p.name, p.category, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
      ${actor.is_admin ? '' : 'WHERE ' + projectAccessSql} ORDER BY p.name, p.id
    `, ...(actor.is_admin ? [] : [actor.id]));
  }

  async function readProject(store, id, actor) {
    const row = await store.get(`
      SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
      WHERE p.id = ? ${actor.is_admin ? '' : 'AND ' + projectAccessSql}
    `, idValue(id), ...(actor.is_admin ? [] : [actor.id]));
    if (!row) throw new RequestError('Project not found.', 404);
    return row;
  }

  async function report(body, actor) {
    const project = await readProject(db, body.id, actor);
    const [shoots, participants, resources, payments, files] = await Promise.all([
      db.all(`
        SELECT s.id, s.title, s.start_at, s.estimate, s.location, s.completed_at, s.shoot_status
          ${actor.is_admin ? ', s.income_paise, s.payment_due_on' : ''}
        FROM tasks s WHERE s.project_id = ? AND s.category = 'Photo shoot' ORDER BY s.start_at
      `, project.id),
      db.all(`
        SELECT s.id AS shoot_id, a.employee_id, e.name, t.category, a.employee_id = t.employee_id AS is_lead
        FROM tasks t JOIN task_assignments a ON a.task_id = t.id JOIN employees e ON e.id = a.employee_id
        JOIN tasks s ON s.id = COALESCE(t.parent_shoot_id, t.id) WHERE s.project_id = ?
        ORDER BY e.name
      `, project.id),
      db.all(`
        SELECT r.id, r.title, r.kind, r.url, r.file_id, f.name AS file_name FROM project_resources r
        LEFT JOIN private_files f ON f.id = r.file_id AND f.removed_at IS NULL
        WHERE r.project_id = ? AND r.removed_at IS NULL AND (r.file_id IS NULL OR f.id IS NOT NULL) ORDER BY r.id DESC
      `, project.id),
      actor.is_admin ? db.all(`
        SELECT k.* FROM payments k JOIN tasks s ON s.id = k.task_id WHERE s.project_id = ? ORDER BY paid_on DESC, id DESC
      `, project.id) : [],
      actor.is_admin ? db.all(`
        SELECT id, name FROM private_files WHERE kind = 'client' AND record_id = ? AND removed_at IS NULL ORDER BY created_at DESC
      `, project.client_id) : [],
    ]);
    const dates = new Set(shoots.filter((row) => row.shoot_status === 'booked').flatMap((row) => {
      const end = row.start_at + row.estimate * 60_000 - 1;
      const first = studioDay(row.start_at);
      const last = studioDay(end);
      return last === first ? [first] : [first, studioDay(row.start_at + dayLength)];
    }));
    const received = payments.reduce((total, row) => total + row.amount_paise, 0);
    const booked = shoots.reduce((total, row) => total + (row.shoot_status === 'cancelled' ?
      payments.filter((p) => p.task_id === row.id).reduce((subtotal, p) => subtotal + p.amount_paise, 0) : row.income_paise ?? 0), 0);
    return { project, shoots, participants, resources, files, days: dates.size, ...(actor.is_admin ? { payments, received, booked, outstanding: booked - received } : {}) };
  }

  function save(body, actor, now) {
    adminOnly(actor);
    const name = text(body.name, 'project name');
    const category = text(body.category, 'project category');
    const description = optional(body.description, 'project notes', 1600);
    return db.transaction(async (store) => {
      const prior = body.id ? await readProject(store, body.id, actor) : null;
      const client = prior?.client_id ?? idValue(body.clientId);
      if (!await store.get('SELECT 1 FROM clients WHERE id = ?', client)) throw new RequestError('Choose an existing client.');
      const row = prior
        ? await store.get('UPDATE projects SET name=?, category=?, description=? WHERE id=? RETURNING *', name, category, description, prior.id)
        : await store.get('INSERT INTO projects(client_id,name,category,description,created_at) VALUES (?,?,?,?,?) RETURNING *', client, name, category, description, now);
      await recordBusinessAudit(store, actor.id, 'project', row.id, prior ? 'project updated' : 'project added', now);
      return row;
    });
  }

  function resource(body, actor, now) {
    adminOnly(actor);
    return db.transaction(async (store) => {
      const project = await readProject(store, body.projectId, actor);
      if (body.remove === true) {
        const deleted = await store.get('UPDATE project_resources SET removed_at = ? WHERE id = ? AND project_id = ? AND removed_at IS NULL RETURNING id',
          now, idValue(body.id), project.id);
        if (!deleted) throw new RequestError('Resource not found.', 404);
        await recordBusinessAudit(store, actor.id, 'project resource', deleted.id, 'resource removed', now, { projectId: project.id });
        return { ok: true };
      }
      const title = text(body.title, 'resource title');
      if (!['document','reference','delivery'].includes(body.kind)) throw new RequestError('Choose a resource type.');
      const urlInput = optional(body.url, 'resource link', 2048);
      const fileId = body.fileId || null;
      if (Boolean(urlInput) === Boolean(fileId)) throw new RequestError('Choose either a link or an uploaded document.');
      let url = null;
      if (urlInput) {
        try {
          const parsed = new URL(urlInput);
          if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
          url = parsed.href;
        } catch {
          throw new RequestError('Enter a valid HTTPS resource link.');
        }
      }
      if (fileId && (!isFileIdentifier(fileId) || !await store.get(`
        SELECT 1 FROM private_files WHERE id = ? AND kind = 'client' AND record_id = ? AND removed_at IS NULL
      `, fileId, project.client_id))) throw new RequestError('Choose a file uploaded for this client.');
      const row = await store.get(`
        INSERT INTO project_resources(project_id,kind,title,url,file_id,added_at) VALUES (?,?,?,?,?,?) RETURNING *
      `, project.id, body.kind, title, url, fileId, now);
      await recordBusinessAudit(store, actor.id, 'project resource', row.id, 'resource added', now, { projectId: project.id, kind: row.kind });
      return row;
    });
  }

  return { listed, report, save, resource };
}
