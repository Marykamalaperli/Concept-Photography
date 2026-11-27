import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hashPassword } from '../lib/accounts.js';
import { attachmentPath, createLocalFiles, fileStoragePath } from '../lib/local-files.js';
import { createBackup, restoreBackup } from '../scripts/database-backup.js';
import { openStore } from '../store.js';
import { sqliteAdapter } from '../sqlite-adapter.js';

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
  const upload = (kind, cookie, body = fileBytes, headers = {}, record = 1) => api('files?kind=' + kind + '&record=' + record, {
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
  assert.equal((await json('task-action', staff, { taskId: 1, action: 'acknowledge' })).status, 200);
  assert.equal((await json('task-action', staff, { taskId: 1, action: 'start' })).status, 200);
  assert.equal((await json('task-action', staff, { taskId: 1, action: 'submit-completion', report: 'Review attached proof', fileId: file.id })).status, 200);
  assert.equal((await api(path, { method: 'DELETE', headers: { cookie: staff } })).status, 409);
  assert.equal((await json('operations/completion', manager, { taskId: 1, decision: 'approve' })).status, 200);
  const loose = await (await upload('client', manager)).json();
  const projectResponse = await json('projects', manager, { clientId: 1, name: 'Private client project', category: 'Portrait' });
  assert.equal(projectResponse.status, 200);
  const project = await projectResponse.json();
  const shootStart = Date.now() + 48 * 3_600_000;
  const bookingResponse = await json('tasks', manager, {
    title: 'Assigned project shoot', category: 'Photo shoot', employeeId: 2, location: 'Studio', latitude: 17.38, longitude: 78.48,
    startAt: new Date(shootStart).toISOString(), endAt: new Date(shootStart + 3_600_000).toISOString(),
    income: '100', clientId: 1, projectId: project.id,
  });
  assert.equal(bookingResponse.status, 200);
  assert.equal((await api('files/' + loose.id, { headers: { cookie: staff } })).status, 404);
  const share = await json('projects/resource', manager, { projectId: project.id, kind: 'document', title: 'Proof', fileId: loose.id });
  assert.equal(share.status, 200);
  assert.equal((await api('files/' + loose.id, { headers: { cookie: staff } })).status, 200);
  assert.equal((await api('files/' + loose.id, { headers: { cookie: stranger } })).status, 404);
  assert.equal((await api('files?kind=client&record=1', { headers: { cookie: staff } })).status, 404);
  assert.equal((await api('files/' + loose.id, { method: 'DELETE', headers: { cookie: manager } })).status, 409);
  assert.equal((await json('projects/resource', manager, { projectId: project.id, id: (await share.json()).id, remove: true })).status, 200);
  assert.equal((await api('files/' + loose.id, { headers: { cookie: staff } })).status, 404);
  assert.equal((await api('files/' + loose.id, { method: 'DELETE', headers: { cookie: manager } })).status, 200);
  assert.equal((await api('files/' + loose.id, { headers: { cookie: manager } })).status, 404);
  const avatarResponse = await upload('profile', staff, fileBytes, {}, 2);
  assert.equal(avatarResponse.status, 201);
  const avatar = await avatarResponse.json();
  const avatarPath = 'avatars/2/' + avatar.id;
  assert.equal((await api(avatarPath, { headers: { cookie: staff } })).status, 404);
  assert.equal((await json('profile/photo', stranger, { employeeId: 2, fileId: avatar.id })).status, 404);
  assert.equal((await json('profile/photo', staff, { fileId: avatar.id })).status, 200);
  const image = await api(avatarPath, { headers: { cookie: manager } });
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), fileBytes);
  assert.equal((await api(avatarPath, { headers: { cookie: stranger } })).status, 404);
  assert.equal((await json('roles/assign', manager, { employeeId: 3, role: 'Studio Assistant' })).status, 200);
  assert.equal((await json('roles', manager, { role: 'Studio Assistant', permissions: ['manage-attachments','manage-resources'] })).status, 200);
  assert.equal((await json('scopes', manager, { kind: 'project', employeeId: 3, recordId: project.id, enabled: true })).status, 200);
  const scoped = await upload('project', stranger, fileBytes, {}, project.id);
  assert.equal(scoped.status, 201);
  const scopedFile = await scoped.json();
  assert.equal((await api('files/' + scopedFile.id, { headers: { cookie: staff } })).status, 404);
  assert.equal((await api('files/' + scopedFile.id, { headers: { cookie: stranger } })).status, 200);
  assert.equal((await json('scopes', manager, { kind: 'project', employeeId: 3, recordId: project.id, enabled: false })).status, 200);
  assert.equal((await api('files/' + scopedFile.id, { headers: { cookie: stranger } })).status, 404);
  const backup = await createBackup(source, join(folder, 'backups'), 30, directory);
  const restored = join(folder, 'restored.sqlite');
  await restoreBackup(backup, restored);
  assert.deepEqual(await readFile(attachmentPath(fileStoragePath(restored), file.id)), fileBytes);
  assert.deepEqual(await readFile(attachmentPath(fileStoragePath(restored), avatar.id)), fileBytes);
  const restoredDb = new DatabaseSync(restored, { readOnly: true });
  try {
    assert.equal(restoredDb.prepare('SELECT active_photo_id FROM employees WHERE id = 2').get().active_photo_id, avatar.id);
  } finally {
    restoredDb.close();
  }
  assert.equal((await api('files/' + avatar.id, { method: 'DELETE', headers: { cookie: staff } })).status, 200);
  assert.equal((await api(avatarPath, { headers: { cookie: staff } })).status, 404);
  assert.equal((await (await api('session', { headers: { cookie: staff } })).json()).actor.active_photo_id, null);
  await assert.rejects(readFile(attachmentPath(fileStoragePath(restored), loose.id)), { code: 'ENOENT' });
  const retentionDb = new DatabaseSync(source);
  try {
    const now = Date.now();
    retentionDb.exec('UPDATE hr_settings SET removed_file_days = 7 WHERE id = 1');
    retentionDb.prepare('UPDATE private_files SET removed_at = ? WHERE id = ?').run(now - 8 * 86_400_000, loose.id);
    const files = createLocalFiles(sqliteAdapter(retentionDb), { directory });
    await files.prune(now);
    assert.equal(retentionDb.prepare('SELECT purged_at FROM private_files WHERE id = ?').get(loose.id).purged_at, now);
    await assert.rejects(readFile(attachmentPath(directory, loose.id)), { code: 'ENOENT' });
    assert.deepEqual(await readFile(attachmentPath(directory, avatar.id)), fileBytes);
    assert.deepEqual(await readFile(attachmentPath(directory, file.id)), fileBytes);
  } finally {
    retentionDb.close();
  }
  await writeFile(attachmentPath(fileStoragePath(backup), file.id), Buffer.alloc(fileBytes.length));
  await assert.rejects(restoreBackup(backup, join(folder, 'invalid.sqlite')), /checksum mismatch/);
});
