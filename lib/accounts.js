import { Buffer } from 'node:buffer';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const lifetime = 12 * 60 * 60 * 1000;
const dummyHash = '0'.repeat(32) + ':' + '0'.repeat(128);
const digest = (token) => createHash('sha256').update(token).digest('hex');
export const sessionFields = ['id', 'name', 'email', 'role', 'phone', 'color', 'is_admin', 'employment_start', 'deactivated', 'permission_role'];

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return salt + ':' + hash.toString('hex');
}

export async function passwordMatches(password, stored) {
  const validHash = typeof stored === 'string' && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const [salt, hash] = (validHash ? stored : dummyHash).split(':');
  const guess = await derive(password, salt, 64);
  return timingSafeEqual(guess, Buffer.from(hash, 'hex')) && validHash;
}

function sessionHash(req) {
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)concept_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token && digest(token);
}

function cookie(token, maxAge, secure) {
  return `concept_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export async function createSession(db, employee, now, res, { secureCookies }) {
  const token = randomBytes(32).toString('hex');
  await Promise.all([
    db.run('DELETE FROM auth_sessions WHERE expires_at <= ?', now),
    db.run('INSERT INTO auth_sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)', digest(token), employee.id, now + lifetime),
  ]);
  const actor = Object.fromEntries(sessionFields.map((field) => [field, employee[field]]));
  actor.permissions = (await db.all('SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission', actor.permission_role)).map((row) => row.permission);
  res.setHeader('Set-Cookie', cookie(token, lifetime / 1000, secureCookies));
  return { ok: true, actor };
}

export async function authenticatedEmployee(db, req, now) {
  const hash = sessionHash(req);
  if (!hash) return null;
  const row = await db.get(`
    SELECT ${sessionFields.map((field) => `employees.${field}`).join(', ')},
      (SELECT json_group_array(permission) FROM (SELECT permission FROM role_permissions WHERE role = employees.permission_role ORDER BY permission)) AS capabilities
    FROM employees JOIN auth_sessions ON employees.id = auth_sessions.employee_id
    WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? AND employees.archived = 0 AND employees.deactivated = 0
  `, hash, now);
  if (!row) return null;
  const { capabilities, ...actor } = row;
  return { ...actor, permissions: JSON.parse(capabilities) };
}

export async function endSession(db, req, res, { secureCookies }) {
  const hash = sessionHash(req);
  if (hash) await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', hash);
  res.setHeader('Set-Cookie', cookie('', 0, secureCookies));
  return { ok: true };
}
