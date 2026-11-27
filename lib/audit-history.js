import { dayLength, dayStart, validDay } from './hr-policy.js';

const pageSize = 50;

export function installAuditHistory(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE business_audit ADD COLUMN result TEXT NOT NULL DEFAULT 'success';
      CREATE INDEX business_audit_subject_date ON business_audit(subject, occurred_at DESC);
      CREATE INDEX business_audit_record ON business_audit(subject, record_id);
      PRAGMA user_version = 24;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function searchAudit(db, body, actor, RequestError) {
  if (!actor.is_admin) throw new RequestError('Audit history is available to administrators only.', 403);
  const filters = [body.from || '', body.to || ''];
  if (filters.some((date) => date && !validDay(date)) || (filters.every(Boolean) && filters[0] > filters[1])) {
    throw new RequestError('Choose a valid audit date range.');
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 100) : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 70) : '';
  const actorId = body.actorId === '' || body.actorId == null ? 0 : Number(body.actorId);
  const page = Number(body.page ?? 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 2000 || !Number.isSafeInteger(actorId) || actorId < 0) {
    throw new RequestError('Choose a valid audit page or actor.');
  }
  const result = await db.all(`
    WITH events AS (
      SELECT id, actor_id, subject, record_id, action, occurred_at, details, result, 'business' AS source FROM business_audit
      UNION ALL
      SELECT id, actor_id, 'account', subject_id, action, occurred_at, '{}',
        CASE WHEN action = 'Sign-in failed' THEN 'denied' ELSE 'success' END, 'access' FROM access_audit
    )
    SELECT events.*, e.name AS actor FROM events LEFT JOIN employees e ON e.id = events.actor_id
    WHERE (? = 0 OR events.occurred_at >= ?) AND (? = 0 OR events.occurred_at < ?)
      AND (? = 0 OR events.actor_id = ?) AND (? = '' OR events.subject = ?)
      AND (? = '' OR instr(lower(events.action || ' ' || events.subject || ' ' || COALESCE(e.name, '') ||
        ' ' || COALESCE(CAST(events.record_id AS TEXT), '')), lower(?)) > 0)
    ORDER BY events.occurred_at DESC, events.source, events.id DESC LIMIT ? OFFSET ?
  `, Number(Boolean(filters[0])), filters[0] ? dayStart(filters[0]) : 0, Number(Boolean(filters[1])),
    filters[1] ? dayStart(filters[1]) + dayLength : 0, actorId, actorId, subject, subject, query, query, pageSize + 1, page * pageSize);
  const subjects = (await db.all("SELECT subject FROM business_audit UNION SELECT 'account' ORDER BY subject")).map((row) => row.subject);
  return { rows: result.slice(0, pageSize), subjects, page, more: result.length > pageSize };
}
