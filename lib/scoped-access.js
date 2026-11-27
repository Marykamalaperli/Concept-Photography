// Role grants determine actions. Explicit scope grants determine which records those actions can reach.
export const businessPermissions = [
  'create-clients', 'edit-clients', 'manage-clients',
  'create-projects', 'edit-projects', 'manage-projects',
  'schedule-shoots', 'assign-crew', 'assign-tasks',
  'manage-resources', 'manage-attachments', 'view-project-reports',
];

export const clientAccessSql = 'EXISTS (SELECT 1 FROM client_staff cs WHERE cs.client_id = c.id AND cs.employee_id = ?)';
export const projectScopeSql = `(EXISTS (SELECT 1 FROM project_staff ps WHERE ps.project_id = p.id AND ps.employee_id = ?)
  OR EXISTS (SELECT 1 FROM client_staff cs WHERE cs.client_id = p.client_id AND cs.employee_id = ?))`;

export function reviewTaskScopeSql(alias) {
  const project = `COALESCE(${alias}.project_id, (SELECT parent.project_id FROM tasks parent WHERE parent.id = ${alias}.parent_shoot_id))`;
  const client = `COALESCE(${alias}.client_id, (SELECT parent.client_id FROM tasks parent WHERE parent.id = ${alias}.parent_shoot_id))`;
  return `((${project} IS NULL AND ${client} IS NULL)
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = ${project} AND ${projectScopeSql})
    OR (${project} IS NULL AND EXISTS (SELECT 1 FROM clients c WHERE c.id = ${client} AND ${clientAccessSql})))`;
}

export const reviewScopeBindings = ({ id }) => [id, id, id];

export async function canReviewTaskRecord(store, actor, taskId) {
  return actor.is_admin || Boolean(await store.get(`SELECT 1 FROM tasks t WHERE t.id = ? AND ${reviewTaskScopeSql('t')}`,
    taskId, ...reviewScopeBindings(actor)));
}

export function installScopedAccess(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE employees ADD COLUMN scope_revision INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE client_staff (
        employee_id INTEGER NOT NULL REFERENCES employees(id), client_id INTEGER NOT NULL REFERENCES clients(id),
        PRIMARY KEY(employee_id, client_id)
      ) STRICT;
      CREATE TABLE project_staff (
        employee_id INTEGER NOT NULL REFERENCES employees(id), project_id INTEGER NOT NULL REFERENCES projects(id),
        PRIMARY KEY(employee_id, project_id)
      ) STRICT;
      ALTER TABLE private_files ADD COLUMN project_id INTEGER REFERENCES projects(id);
      CREATE INDEX private_files_project ON private_files(project_id, removed_at);
      PRAGMA user_version = 22;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const projectPermissions = businessPermissions.filter((item) =>
  !['create-clients', 'edit-clients', 'manage-clients', 'create-projects'].includes(item));
export const hasProjectAccess = (actor) => actor.permissions?.some((item) => projectPermissions.includes(item));

export const hasBusinessAccess = (actor) => actor.is_admin || actor.permissions?.some((item) => businessPermissions.includes(item));

export async function roleAllows(store, actor, permission) {
  return actor.is_admin || Boolean(await store.get(`
    SELECT 1 FROM employees e JOIN role_permissions r ON r.role = e.permission_role
    WHERE e.id = ? AND e.archived = 0 AND e.deactivated = 0 AND r.permission = ?
  `, actor.id, permission));
}

export function inScope(store, actor, kind, id) {
  if (!id || !['project', 'client'].includes(kind)) return false;
  if (kind === 'project') return store.get(`SELECT p.id FROM projects p WHERE p.id = ? ${actor.is_admin ? '' : 'AND ' + projectScopeSql}`,
    id, ...(actor.is_admin ? [] : [actor.id, actor.id]));
  return store.get(`SELECT c.id FROM clients c WHERE c.id = ? ${actor.is_admin ? '' : 'AND ' + clientAccessSql}`,
    id, ...(actor.is_admin ? [] : [actor.id]));
}

export async function canManage(store, actor, permission, kind, id) {
  return await roleAllows(store, actor, permission) && Boolean(await inScope(store, actor, kind, id));
}
