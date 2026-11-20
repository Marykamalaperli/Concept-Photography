import { Buffer } from 'node:buffer';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
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

function sessionHash(req, bearer) {
  const token = bearer
    ? (req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/i)?.[1]
    : (req.headers.cookie || '').match(/(?:^|;\s*)concept_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  return token && digest(token);
}

function cookie(token, maxAge, secure) {
  return `concept_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export async function createSession(db, employeeId, now, res, { bearer, secureCookies }) {
  const token = randomBytes(32).toString('hex');
  await db.run('DELETE FROM auth_sessions WHERE expires_at <= ?', now);
  await db.run('INSERT INTO auth_sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)', digest(token), employeeId, now + lifetime);
  if (bearer) return { token };
  res.setHeader('Set-Cookie', cookie(token, lifetime / 1000, secureCookies));
  return { ok: true };
}

export async function authenticatedEmployee(db, req, now, bearer) {
  const hash = sessionHash(req, bearer);
  if (!hash) return null;
  return (await db.get(`
    SELECT employees.id, employees.name, employees.email, employees.role, employees.phone, employees.color, employees.is_admin
    FROM employees JOIN auth_sessions ON employees.id = auth_sessions.employee_id
    WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ? AND employees.archived = 0
  `, hash, now)) ?? null;
}

export async function endSession(db, req, res, { bearer, secureCookies }) {
  const hash = sessionHash(req, bearer);
  if (hash) await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', hash);
  if (!bearer) res.setHeader('Set-Cookie', cookie('', 0, secureCookies));
  return { ok: true };
}
