import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';
import { attachmentPath, fileStoragePath } from '../lib/local-files.js';

export function verifyDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = db.prepare('PRAGMA user_version').get().user_version;
    if (schema < 1 || !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'employees'").get()) {
      throw new Error('This file is not a Concept Photography database.');
    }
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('The database failed its integrity check.');
    }
    return { schema };
  } finally {
    db.close();
  }
}

async function verifyAttachments(database, directory, destination) {
  const db = new DatabaseSync(database, { readOnly: true });
  let count = 0;
  try {
    const hasFiles = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'private_files'").get();
    if (!hasFiles) return count;
    const rows = db.prepare('SELECT id, byte_length, sha256 FROM private_files WHERE removed_at IS NULL ORDER BY id');
    for (const row of rows.iterate()) {
      const file = await open(attachmentPath(directory, row.id), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let bytes;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size !== row.byte_length || info.size > 10 * 1024 * 1024) {
          throw new Error('Attachment size is invalid for ' + row.id);
        }
        bytes = await file.readFile();
      } finally {
        await file.close();
      }
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('Attachment checksum mismatch for ' + row.id);
      if (destination) {
        await mkdir(destination, { recursive: true, mode: 0o700 });
        await writeFile(attachmentPath(destination, row.id), bytes, { flag: 'wx', mode: 0o600 });
      }
      count++;
    }
    return count;
  } finally {
    db.close();
  }
}

async function snapshot(source, target, sourceDirectory = fileStoragePath(source)) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(target), 'concept-backup-'));
  const temporary = join(staging, 'verified.sqlite');
  try {
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(db, temporary);
    } finally {
      db.close();
    }
    const { schema } = verifyDatabase(temporary);
    const attachments = join(staging, 'attachments');
    const count = await verifyAttachments(temporary, sourceDirectory, attachments);
    const targetDirectory = fileStoragePath(target);
    if (count) await mkdir(targetDirectory, { mode: 0o700 });
    try {
      if (count) {
        for (const entry of await readdir(attachments)) {
          await copyFile(attachmentPath(attachments, entry), attachmentPath(targetDirectory, entry), constants.COPYFILE_EXCL);
        }
      }
      await copyFile(temporary, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if (count) await rm(targetDirectory, { recursive: true, force: true });
      throw error;
    }
    return { schema, attachments: count };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function recordRecovery(target, action, details) {
  const db = new DatabaseSync(target);
  try {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'business_audit'").get()) {
      db.prepare('INSERT INTO business_audit(actor_id, record_id, subject, action, occurred_at, details) VALUES (NULL, 1, ?, ?, ?, ?)')
        .run('database recovery', action, Date.now(), JSON.stringify(details));
    }
    return details.schema >= 27 ? db.prepare('SELECT backup_days FROM hr_settings WHERE id = 1').get()?.backup_days : null;
  } finally {
    db.close();
  }
}

export async function createBackup(source, directory, retentionDays = 30, sourceDirectory = fileStoragePath(source)) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('Backup retention must be from 1 to 3650 days.');
  }
  const now = new Date();
  const stamp = now.toISOString().replaceAll(':', '-');
  const target = resolve(directory, `workspace-${stamp}-${randomUUID()}.sqlite`);
  const copy = await snapshot(source, target, sourceDirectory);
  const effectiveDays = recordRecovery(target, 'backup verified', copy) ?? retentionDays;
  const backupName = /^workspace-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)-[a-f0-9-]{36}\.sqlite$/;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const date = entry.isFile() && backupName.exec(entry.name);
    if (date && Date.parse(`${date[1]}:${date[2]}:${date[3]}`) < now - effectiveDays * 86_400_000) {
      await rm(join(directory, entry.name));
      await rm(fileStoragePath(join(directory, entry.name)), { recursive: true, force: true });
    }
  }
  return target;
}

export async function restoreBackup(source, destination) {
  verifyDatabase(source);
  const target = resolve(destination);
  const copy = await snapshot(source, target);
  recordRecovery(target, 'restore verified', copy);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'win32') process.umask(0o077);
  const [action, filename, directory] = process.argv.slice(2);
  const source = filename ?? (action === 'backup' ? process.env.DATABASE_PATH || 'data/workforce.sqlite' : null);
  const destination = directory ?? (action === 'backup' ? process.env.BACKUP_DIRECTORY || 'backups' : null);
  try {
    if (action === 'verify' && source) {
      console.log(JSON.stringify({ ...verifyDatabase(source), attachments: await verifyAttachments(source, fileStoragePath(source)) }));
    } else if (action === 'backup' && source && destination) {
      console.log(await createBackup(source, destination, Number(process.env.BACKUP_RETENTION_DAYS || 30),
        fileStoragePath(source, process.env.FILE_STORAGE_DIRECTORY)));
    } else if (action === 'restore' && source && destination) {
      console.log(await restoreBackup(source, destination));
    } else {
      throw new Error('Usage: node scripts/database-backup.js verify FILE | backup DATABASE DIRECTORY | restore BACKUP NEW_DATABASE');
    }
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Choose a new destination. The existing database is protected.' : error.message);
    process.exitCode = 1;
  }
}
