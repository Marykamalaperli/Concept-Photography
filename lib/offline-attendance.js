import { constants, createHmac, generateKeyPair, privateDecrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { notifyAdmins, recordBusinessAudit } from './studio-notices.js';

export function installOfflineAttendanceSchema(db) {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE offline_departures (
      id TEXT NOT NULL, employee_id INTEGER NOT NULL REFERENCES employees(id), shift_id INTEGER NOT NULL REFERENCES attendance(id),
      reported_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('reported','conflict')),
      review_id INTEGER REFERENCES shift_reviews(id), PRIMARY KEY(employee_id,id)
    ) STRICT;
    PRAGMA user_version = 18;
    COMMIT;
  `);
}

export function installOfflineKeys(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE offline_encryption (
        id INTEGER PRIMARY KEY CHECK(id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL,
        binding_key TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 21;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const generateKeys = promisify(generateKeyPair);
const readKeys = (db) => db.get('SELECT public_key, private_key, binding_key FROM offline_encryption WHERE id = 1');

export function createOfflineAttendance(db, hours, { RequestError, idValue }) {
  let generating;
  async function provision(actor) {
    let keys = await readKeys(db);
    if (!keys) {
      generating ??= (async () => {
        const pair = await generateKeys('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: { type: 'spki', format: 'der' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        await db.run(`
          INSERT INTO offline_encryption(id, public_key, private_key, binding_key) VALUES(1, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `, pair.publicKey.toString('base64'), pair.privateKey, randomBytes(32).toString('hex'));
        return readKeys(db);
      })().finally(() => { generating = undefined; });
      keys = await generating;
    }
    return { publicKey: keys.public_key, accountBinding: createHmac('sha256', keys.binding_key).update(String(actor.id)).digest('hex') };
  }

  async function sync(body, actor, now) {
    if (Object.hasOwn(body, 'encrypted')) {
      if (typeof body.encrypted !== 'string' || !/^[A-Za-z0-9+/]{342}==$/.test(body.encrypted)) {
        throw new RequestError('The saved departure report could not be opened.');
      }
      const keys = await readKeys(db);
      try {
        const plain = privateDecrypt({
          key: keys.private_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256',
        }, Buffer.from(body.encrypted, 'base64'));
        body = JSON.parse(plain.toString('utf8'));
      } catch {
        throw new RequestError('The saved departure report could not be opened.');
      }
      if (body?.employeeId !== actor.id) throw new RequestError('This departure report belongs to a different account.', 403);
    }
    const key = body.requestId;
    const timestamp = Number(body.reportedAt);
    if (typeof key !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(key) || !Number.isSafeInteger(timestamp)) {
      throw new RequestError('This offline request needs a time correction.');
    }
    return db.transaction(async (store) => {
      const prior = await store.get('SELECT * FROM offline_departures WHERE id = ? AND employee_id = ?', key, actor.id);
      if (prior) return prior;
      if (timestamp > now + 60_000 || timestamp < now - 86_400_000) throw new RequestError('This offline request needs a time correction.');
      const shift = await store.get('SELECT * FROM attendance WHERE id = ? AND employee_id = ?', idValue(body.shiftId), actor.id);
      if (!shift || timestamp < shift.clock_in) throw new RequestError('This offline departure does not match a shift.', 404);
      const latest = await store.get('SELECT id FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1', actor.id);
      const overlap = await store.get(`
        SELECT 1 FROM task_sessions WHERE employee_id = ? AND start_at > ? AND end_at IS NULL
        UNION ALL SELECT 1 FROM work_periods WHERE employee_id = ? AND start_at > ? AND end_at IS NULL
      `, actor.id, timestamp, actor.id, timestamp);
      const existingReview = await store.get('SELECT 1 FROM shift_reviews WHERE attendance_id = ?', shift.id);
      const conflict = shift.id !== latest.id || shift.clock_out !== null || (shift.last_verified_at ?? shift.clock_in) > timestamp ||
        Boolean(overlap || existingReview);
      let review = null;
      if (!conflict) review = await hours.endShift(store, shift, { shiftId: shift.id }, actor, Math.min(timestamp, now), 'offline-reported');
      const row = await store.get(`
        INSERT INTO offline_departures(id, employee_id, shift_id, reported_at, received_at, status, review_id)
        VALUES(?, ?, ?, ?, ?, ?, ?) RETURNING *
      `, key, actor.id, shift.id, timestamp, now, conflict ? 'conflict' : 'reported', review?.id ?? null);
      await recordBusinessAudit(store, actor.id, 'offline attendance', shift.id, row.status, now, { timestamp, review: review?.id });
      if (conflict) {
        await notifyAdmins(store, 'offline-conflict:' + key, 'Offline departure conflicts with attendance',
          actor.name + ' · Check the attendance and business audit before applying a time correction.', now);
      }
      return row;
    });
  }

  return { sync, provision };
}
