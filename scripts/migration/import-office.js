import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../../store.js';
import { writeBaselinePolicy } from '../../lib/business-settings.js';

const tables = [
  'employees', 'office', 'clients', 'tasks', 'task_sessions', 'attendance', 'reminders',
  'work_requests', 'payments', 'expenses', 'hr_settings', 'holidays', 'hr_requests', 'work_logs',
  'payslips', 'announcements', 'shoot_crew',
];
const balances = [
  ['tasks', 'income_paise', 'bookedValuePaise'],
  ['payments', 'amount_paise', 'receivedPaise'],
  ['expenses', 'amount_paise', 'spentPaise'],
];
const localHash = /^[a-f0-9]{32}:[a-f0-9]{128}$/;

function convert(value, type) {
  if (value === null) return null;
  if (type === 'INTEGER') {
    const integer = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(integer)) throw new Error('Invalid or unsafe integer.');
    return integer;
  }
  if (type === 'REAL' && typeof value === 'number' && Number.isFinite(value)) return value;
  if (type === 'TEXT' && typeof value === 'string') return value;
  throw new Error('Invalid column type.');
}

function importSnapshot(db, snapshot) {
  if (snapshot?.format_version !== 1 || !snapshot.tables ||
      JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify([...tables].sort())) {
    throw new Error('Use a complete version 1 export created with export-legacy.sql.');
  }
  const counts = {};
  let reEnrollment = 0;
  db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON; DELETE FROM hr_settings;');
  try {
    for (const table of tables) {
      const rows = snapshot.tables[table];
      if (!Array.isArray(rows)) throw new Error(`The export is missing the ${table} table.`);
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      const byName = new Map(columns.map(({ name, type }) => [name, type]));
      if (table === 'hr_settings' && rows.length !== 1) throw new Error('The export must contain the studio settings row.');
      const statements = new Map();
      for (let index = 0; index < rows.length; index++) {
        try {
          const row = rows[index];
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid row.');
          const keys = Object.keys(row).sort();
          if (!keys.length || keys.some((column) => !byName.has(column))) throw new Error('Unknown or missing column.');
          const statementKey = keys.join(',');
          if (!statements.has(statementKey)) {
            statements.set(statementKey, db.prepare(`INSERT INTO ${table} (${statementKey})
              VALUES (${keys.map(() => '?').join(',')})`));
          }
          if (table === 'employees' && (Number(row.is_admin) === 1 || !localHash.test(row.password_hash ?? ''))) {
            row.password_hash = null;
            if (!Number(row.archived)) reEnrollment++;
          }
          statements.get(statementKey).run(...keys.map((column) => convert(row[column], byName.get(column))));
        } catch {
          throw new Error(`Invalid or duplicate data in ${table} at export row ${index + 1}.`);
        }
      }
      const count = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
      if (count !== rows.length) throw new Error(`Record count mismatch in ${table}.`);
      counts[table] = count;
    }
    writeBaselinePolicy(db);
    if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('The export contains broken record relationships.');
    const financialTotals = {};
    for (const [table, column, label] of balances) {
      const source = snapshot.tables[table].reduce((sum, row) => sum + BigInt(convert(row[column], 'INTEGER')), 0n);
      const query = db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table}`);
      query.setReadBigInts(true);
      if (query.get().total !== source) throw new Error(`Financial total mismatch in ${table}.`);
      financialTotals[label] = source.toString();
    }
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('SQLite integrity verification failed.');
    }
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
    return { counts, financialTotals, accountsRequiringEnrollment: reEnrollment };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export async function migrateOffice({ source, destination }) {
  const snapshot = JSON.parse(await readFile(source, 'utf8'));
  const target = destination && resolve(destination);
  if (target) await mkdir(dirname(target), { recursive: true });
  const directory = await mkdtemp(join(target ? dirname(target) : tmpdir(), 'concept-import-'));
  const temporary = join(directory, 'verified.sqlite');
  try {
    let report;
    const db = new DatabaseSync(temporary);
    try {
      report = importSnapshot(openStore(db), snapshot);
    } finally {
      db.close();
    }
    if (target) await copyFile(temporary, target, constants.COPYFILE_EXCL);
    return { mode: target ? 'import' : 'dry-run', ...report };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [source, flag, destination] = process.argv.slice(2);
    if (!source || (flag !== '--dry-run' && flag !== '--output') ||
        (flag === '--output' && !destination) || (flag === '--dry-run' && destination)) {
      throw new Error('Usage: node scripts/migration/import-office.js export.json --dry-run | --output new.sqlite');
    }
    const report = await migrateOffice({ source, destination });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (error.code === 'EEXIST') console.error('Choose a new destination. The existing database is protected.');
    else if (error instanceof SyntaxError) console.error('The export is not valid JSON.');
    else console.error(error.message);
    process.exitCode = 1;
  }
}
