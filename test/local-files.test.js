import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hashPassword } from '../lib/accounts.js';
import { attachmentPath, fileStoragePath } from '../lib/local-files.js';
import { createBackup, restoreBackup } from '../scripts/database-backup.js';
import { openStore } from '../store.js';

const password = 'Synthetic local file passphrase';
const fileBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/njcAAAAASUVORK5CYII=', 'base64');

test('private uploads enforce scope, protect completion evidence and restore original attachment bytes', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'concept-private-files-'));
  const source = join(folder, 'workspace.sqlite');
  const directory = join(folder, 'custom files');
  const db = openStore(new DatabaseSync(source));
  const hash = await hashPassword(password);
  try {
    const employee = db.prepare(`
      INSERT INTO employees (id, name, role, email, color, is_admin, password_hash) VALUES (?, ?, 'Editor', ?, 'sage', ?, ?)
    `);
    for (const [id, name, manager] of [[1, 'Manager', 1], [2, 'Editor', 0], [3, 'Unassigned', 0]]) {
      employee.run(id, name, name.toLowerCase() + '@example.invalid', manager, hash);
    }
    db.prepare(`
      INSERT INTO tasks (id, title, employee_id, category, start_at, estimate, location) VALUES (1, 'Evidence review', 2, 'Editing', ?, 60, 'Studio')
    `).run(Date.now());
    db.exec("INSERT INTO clients (id, name, phone) VALUES (1, 'Client', '9000000000');");
  } finally {
    db.close();
  }

  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, DATABASE_PATH: source, FILE_STORAGE_DIRECTORY: directory, HOST: '127.0.0.1', PORT: '0', ENABLE_WEB_PUSH: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const stop = once(server, 'exit');
      server.kill();
      await stop;
    }
    await rm(folder, { recursive: true, force: true });
  });
  const base = await new Promise((ready, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error('Test server exited with status ' + code)));
    server.stdout.on('data', (chunk) => {
      const url = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (url) ready(url[0]);
    });
  });
  const api = (path, options) => fetch(base + '/api/' + path, options);
  const signIn = async (name) => {
    const response = await api('login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: name + '@example.invalid', password }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const [staff, manager, stranger] = await Promise.all([signIn('editor'), signIn('manager'), signIn('unassigned')]);
  const upload = (kind, cookie, body = fileBytes, headers = {}) => api('files?kind=' + kind + '&record=1', {
    method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('Test evidence.png'), ...headers }, body,
  });
  const json = (path, cookie, body) => api(path, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await upload('task', staff, fileBytes, { origin: 'https://external.example.invalid' })).status, 403);
  assert.equal((await upload('task', stranger)).status, 404);
  assert.equal((await upload('client', staff)).status, 404);
  assert.equal((await upload('task', staff, Buffer.from('This is a text file'))).status, 415);
  assert.equal((await upload('task', staff, Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await api('files?kind=task&record=1')).status, 401);
  const result = await upload('task', staff);
  assert.equal(result.status, 201);
  const file = await result.json();
  const path = 'files/' + file.id;
  assert.equal((await api(path, { headers: { cookie: stranger } })).status, 404);
  assert.equal((await api('files/%2e%2e%2fworkspace.sqlite', { headers: { cookie: manager } })).status, 404);
  const download = await api(path, { headers: { cookie: manager } });
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.match(download.headers.get('content-disposition'), /^attachment;.*Test%20evidence\.png/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fileBytes);
  assert.equal((await json('task-action', staff, { taskId: 1, action: 'start' })).status, 200);
  assert.equal((await json('task-action', staff, { taskId: 1, action: 'submit-completion', report: 'Review attached proof', fileId: file.id })).status, 200);
  assert.equal((await api(path, { method: 'DELETE', headers: { cookie: staff } })).status, 409);
  assert.equal((await json('operations/completion', manager, { taskId: 1, decision: 'approve' })).status, 200);
  const loose = await (await upload('client', manager)).json();
  assert.equal((await api('files/' + loose.id, { method: 'DELETE', headers: { cookie: manager } })).status, 200);
  assert.equal((await api('files/' + loose.id, { headers: { cookie: manager } })).status, 404);
  const backup = await createBackup(source, join(folder, 'backups'), 30, directory);
  const restored = join(folder, 'restored.sqlite');
  await restoreBackup(backup, restored);
  assert.deepEqual(await readFile(attachmentPath(fileStoragePath(restored), file.id)), fileBytes);
  await assert.rejects(readFile(attachmentPath(fileStoragePath(restored), loose.id)), { code: 'ENOENT' });
  await writeFile(attachmentPath(fileStoragePath(backup), file.id), Buffer.alloc(fileBytes.length));
  await assert.rejects(restoreBackup(backup, join(folder, 'invalid.sqlite')), /checksum mismatch/);
});
