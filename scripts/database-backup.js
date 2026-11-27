import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

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

async function snapshot(source, target) {
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
    verifyDatabase(temporary);
    await copyFile(temporary, target, constants.COPYFILE_EXCL);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return target;
}

export async function createBackup(source, directory, retentionDays = 30) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('Backup retention must be from 1 to 3650 days.');
  }
  const now = new Date();
  const stamp = now.toISOString().replaceAll(':', '-');
  const target = resolve(directory, `workspace-${stamp}-${randomUUID()}.sqlite`);
  await snapshot(source, target);
  const backupName = /^workspace-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)-[a-f0-9-]{36}\.sqlite$/;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const date = entry.isFile() && backupName.exec(entry.name);
    if (date && Date.parse(`${date[1]}:${date[2]}:${date[3]}`) < now - retentionDays * 86_400_000) {
      await rm(join(directory, entry.name));
    }
  }
  return target;
}

export async function restoreBackup(source, destination) {
  verifyDatabase(source);
  return snapshot(source, resolve(destination));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'win32') process.umask(0o077);
  const [action, filename, directory] = process.argv.slice(2);
  const source = filename ?? (action === 'backup' ? process.env.DATABASE_PATH || 'data/workforce.sqlite' : null);
  const destination = directory ?? (action === 'backup' ? process.env.BACKUP_DIRECTORY || 'backups' : null);
  try {
    if (action === 'verify' && source) {
      console.log(JSON.stringify(verifyDatabase(source)));
    } else if (action === 'backup' && source && destination) {
      console.log(await createBackup(source, destination, Number(process.env.BACKUP_RETENTION_DAYS || 30)));
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
