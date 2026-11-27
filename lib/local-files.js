import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { authenticatedEmployee } from './accounts.js';
import { recordBusinessAudit } from './studio-notices.js';

const MiB = 1024 * 1024;
const maxFileBytes = 10 * MiB;
const day = 86_400_000;
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const purposes = {
  task: 'tasks', client: 'clients', expense: 'expenses', profile: 'employees',
};
export const isFileIdentifier = (id) => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
export const fileStoragePath = (database, directory) => resolve(directory || join(dirname(database), basename(database) + '.files'));
export const attachmentPath = (directory, id) => {
  if (!isFileIdentifier(id)) throw new Error('Invalid attachment identifier.');
  return join(directory, id);
};

class FileError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function mediaFor(content) {
  if (content.length >= 24 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && content.toString('ascii', 12, 16) === 'IHDR') {
    return ['image/png', '.png'];
  }
  if (content.length >= 4 && content.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && content.at(-2) === 255 && content.at(-1) === 217) {
    return ['image/jpeg', '.jpg'];
  }
  if (content.length >= 10 && /^%PDF-[12]\.\d/.test(content.toString('ascii', 0, 8)) && content.subarray(-1024).includes(Buffer.from('%%EOF'))) {
    return ['application/pdf', '.pdf'];
  }
  throw new FileError('Choose a valid PNG, JPEG or PDF file.', 415);
}

function filename(input, extension) {
  const name = input.normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, ' ').trim();
  const stem = (name.replace(/\.[^.]+$/, '').trim().slice(0, 100) || 'Attachment');
  return stem + extension;
}

function respond(res, status, body) {
  res.writeHead(status, { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function verifyMutation(req, siteOrigin) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (siteOrigin ? url.origin === siteOrigin : url.host === req.headers.host && ['http:', 'https:'].includes(url.protocol)) return;
    } catch {
      // Reject invalid or foreign browser origins.
    }
    throw new FileError('Submit this request from the workspace.', 403);
  }
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    throw new FileError('Submit this request from the workspace.', 403);
  }
}

async function allow(store, actor, kind, record, mode) {
  if (!Object.hasOwn(purposes, kind) || !Number.isSafeInteger(record) || record <= 0) throw new FileError('File record not found.', 404);
  if ((kind === 'expense' || kind === 'client') && !actor.is_admin) throw new FileError('File record not found.', 404);
  if (kind === 'profile' && !actor.is_admin && actor.id !== record) throw new FileError('File record not found.', 404);
  if (kind === 'task' && !actor.is_admin && !await store.get('SELECT 1 FROM task_assignments WHERE task_id = ? AND employee_id = ?', record, actor.id)) {
    throw new FileError('File record not found.', 404);
  }
  const item = await store.get('SELECT * FROM ' + purposes[kind] + ' WHERE id = ?', record);
  if (!item || (kind === 'profile' && item.archived)) throw new FileError('File record not found.', 404);
  if (mode === 'upload' && kind === 'task' && (item.is_open || item.completed_at || item.shoot_status !== 'booked')) {
    throw new FileError('Attachments can only be added to active tasks.', 409);
  }
}

function nameForHeaders(name) {
  return 'attachment; filename="attachment' + name.match(/\.[a-z]+$/)?.[0] + '"; filename*=UTF-8\'\'' +
    encodeURIComponent(name).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

export function createLocalFiles(db, { directory, siteOrigin, retentionDays = 30 }) {
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) {
    throw new Error('FILE_RETENTION_DAYS must be between 7 and 3650 days.');
  }

  let activeUploads = 0;

  async function upload(req, actor, kind, record, now) {
    await allow(db, actor, kind, record, 'upload');
    if (req.headers['content-type'] !== 'application/octet-stream') throw new FileError('Use a binary file upload.', 415);
    const maximum = kind === 'profile' ? 3 * MiB : maxFileBytes;
    if (!/^\d+$/.test(req.headers['content-length'] ?? '')) throw new FileError('A file size is required.', 411);
    const declared = Number(req.headers['content-length']);
    if (declared < 1 || declared > maximum) throw new FileError('The uploaded file is too large or empty.', 413);
    let originalName;
    try { originalName = decodeURIComponent(req.headers['x-file-name'] ?? 'Attachment'); }
    catch { throw new FileError('Choose a file with a valid name.', 400); }
    if (originalName.length > 250) throw new FileError('Use a file name shorter than 250 characters.', 400);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maximum) throw new FileError('The uploaded file is too large.', 413);
      chunks.push(chunk);
    }
    if (bytes !== declared) throw new FileError('The file upload was incomplete.', 400);
    const payload = Buffer.concat(chunks, bytes);
    const [media, extension] = mediaFor(payload);
    if (kind === 'profile' && media === 'application/pdf') throw new FileError('Profile photos must be PNG or JPEG.', 415);
    const displayName = filename(originalName, extension);
    const digest = createHash('sha256').update(payload).digest('hex');
    const id = randomUUID();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = attachmentPath(directory, id);
    const handle = await open(path, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(payload);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return await db.transaction(async (store) => {
        const current = await store.get('SELECT id FROM employees WHERE id = ? AND archived = 0 AND deactivated = 0', actor.id);
        if (!current) throw new FileError('Sign in to manage attachments.', 401);
        await allow(store, actor, kind, record, 'upload');
        const existing = await store.get('SELECT COUNT(*) AS count FROM private_files WHERE kind = ? AND record_id = ? AND removed_at IS NULL', kind, record);
        if (existing.count >= 20) throw new FileError('Remove an old attachment before adding another. Each record supports 20 files.', 409);
        const file = await store.get(`
          INSERT INTO private_files(id,kind,record_id,uploaded_by,name,media_type,byte_length,sha256,created_at)
          VALUES (?,?,?,?,?,?,?,?,?) RETURNING id, name, media_type, byte_length, created_at
        `, id, kind, record, actor.id, displayName, media, bytes, digest, now);
        await recordBusinessAudit(store, actor.id, 'attachment', record, 'file uploaded', now, { id, kind, name: displayName, bytes });
        return file;
      });
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  async function fileFor(actor, id) {
    const item = isFileIdentifier(id) && await db.get('SELECT * FROM private_files WHERE id = ? AND removed_at IS NULL', id);
    if (!item) throw new FileError('Attachment not found.', 404);
    await allow(db, actor, item.kind, item.record_id, 'read');
    return item;
  }

  async function remove(id, actor, now) {
    return db.transaction(async (store) => {
      const item = isFileIdentifier(id) && await store.get('SELECT * FROM private_files WHERE id = ? AND removed_at IS NULL', id);
      if (!item) throw new FileError('Attachment not found.', 404);
      await allow(store, actor, item.kind, item.record_id, 'read');
      if (!actor.is_admin && item.uploaded_by !== actor.id) throw new FileError('Only the uploader or an administrator can remove this attachment.', 403);
      if (await store.get('SELECT 1 FROM tasks WHERE completion_file_id = ?', id)) {
        throw new FileError('This attachment is retained with a reviewed completion.', 409);
      }
      await store.run('UPDATE private_files SET removed_at = ?, removed_by = ? WHERE id = ?', now, actor.id, id);
      await recordBusinessAudit(store, actor.id, 'attachment', item.record_id, 'file removed', now, { id, kind: item.kind, name: item.name });
      return { ok: true };
    });
  }

  async function serve(req, res, url) {
    const now = Date.now();
    const actor = await authenticatedEmployee(db, req, now);
    if (!actor) throw new FileError('Sign in to access attachments.', 401);
    const { pathname: path, searchParams: query } = url;
    if (req.method === 'POST' || req.method === 'DELETE') verifyMutation(req, siteOrigin);
    if (path === '/api/files') {
      const kind = query.get('kind');
      const record = Number(query.get('record'));
      if (req.method === 'GET') {
        await allow(db, actor, kind, record, 'read');
        respond(res, 200, await db.all(`
          SELECT id, name, media_type, byte_length, created_at, uploaded_by FROM private_files
          WHERE kind = ? AND record_id = ? AND removed_at IS NULL ORDER BY created_at DESC
        `, kind, record));
        return;
      }
      if (req.method === 'POST') {
        if (activeUploads >= 4) throw new FileError('Other uploads are finishing. Try in a moment.', 429);
        activeUploads++;
        try {
          respond(res, 201, await upload(req, actor, kind, record, now));
        } finally {
          activeUploads--;
        }
        return;
      }
    }
    const id = path.slice('/api/files/'.length);
    if (isFileIdentifier(id) && req.method === 'DELETE') {
      respond(res, 200, await remove(id, actor, now));
      return;
    }
    if (isFileIdentifier(id) && ['GET', 'HEAD'].includes(req.method)) {
      const item = await fileFor(actor, id);
      const file = await open(attachmentPath(directory, id), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size !== item.byte_length) throw new FileError('The stored attachment requires administrator review.', 409);
        res.writeHead(200, { ...privateHeaders, 'Content-Type': 'application/octet-stream',
          'Content-Disposition': nameForHeaders(item.name), 'Content-Length': info.size });
        if (req.method === 'HEAD') res.end();
        else await pipeline(file.createReadStream({ autoClose: false }), res);
      } finally {
        await file.close();
      }
      return;
    }
    throw new FileError('Attachment route not found.', 404);
  }

  async function prune(now = Date.now()) {
    const files = await db.all('SELECT id FROM private_files WHERE removed_at < ? AND purged_at IS NULL LIMIT 100', now - retentionDays * day);
    for (const file of files) {
      await rm(attachmentPath(directory, file.id), { force: true });
      await db.run('UPDATE private_files SET purged_at = ? WHERE id = ? AND purged_at IS NULL', now, file.id);
    }
  }

  return { serve, prune };
}
