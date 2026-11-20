import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const cookieName = 'concept_session';
const lifetime = 12 * 60 * 60 * 1000;
const dummyHash = '0'.repeat(32) + ':' + '0'.repeat(128);
const digest = (token) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return salt + ':' + hash.toString('hex');
}

export async function passwordMatches(password, stored) {
  const [salt, hash] = (stored || dummyHash).split(':');
  const guess = await derive(password, salt, 64);
  return timingSafeEqual(guess, Buffer.from(hash, 'hex')) && Boolean(stored);
}

function sessionHash(req) {
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)concept_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token && digest(token);
}

function cookie(token, maxAge, secure) {
  return `${cookieName}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function createSession(db, employeeId, now, secure) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)').run(digest(token), employeeId, now + lifetime);
  return cookie(token, lifetime / 1000, secure);
}

export function authenticatedEmployee(db, req, now) {
  const hash = sessionHash(req);
  if (!hash) return null;
  return db.prepare(`
    SELECT employees.id, employees.name, employees.email, employees.role, employees.phone, employees.color, employees.is_admin
    FROM employees JOIN auth_sessions ON employees.id = auth_sessions.employee_id
    WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? AND employees.archived = 0
  `).get(hash, now) ?? null;
}

export function endSession(db, req, secure) {
  const hash = sessionHash(req);
  if (hash) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
  return cookie('', 0, secure);
}
