import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store.js';
import { hashPassword } from '../lib/accounts.js';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) {
      input += chunk;
      if (input.length > 130) throw new Error('Use a password between 12 and 128 characters.');
    }
    return input.replace(/\r?\n$/, '');
  }
  const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const terminal = createInterface({ input: process.stdin, output: hidden, terminal: true });
  process.stderr.write('Local admin password: ');
  try {
    return await terminal.question('');
  } finally {
    terminal.close();
    process.stderr.write('\n');
  }
}

process.umask(0o077);

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: npm run create-local-admin -- admin@example.com');
  }
  const password = await readPassword();
  if (password.length < 12 || password.length > 128 || !password.trim() || /[\r\n]/.test(password)) {
    throw new Error('Use a password between 12 and 128 characters.');
  }

  const path = process.env.DATABASE_PATH || fileURLToPath(new URL('../data/workforce.sqlite', import.meta.url));
  const hash = await hashPassword(password);
  mkdirSync(dirname(path), { recursive: true });
  const db = openStore(new DatabaseSync(path));
  try {
    db.exec('BEGIN IMMEDIATE');
    const admin = db.prepare('SELECT id FROM employees WHERE is_admin = 1 AND archived = 0').get();
    const existing = db.prepare('SELECT id FROM employees WHERE email = ?').get(email);
    if (existing && existing.id !== admin?.id) throw new Error('That email already belongs to another studio profile.');
    if (admin) {
      db.prepare('UPDATE employees SET email = ?, password_hash = ? WHERE id = ?').run(email, hash, admin.id);
      db.prepare('DELETE FROM auth_sessions WHERE employee_id = ?').run(admin.id);
    } else {
      db.prepare(`
        INSERT INTO employees (name, role, email, color, is_admin, password_hash)
        VALUES ('Studio Administrator', 'Administrator', ?, 'peach', 1, ?)
      `).run(email, hash);
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  console.log('Local admin credentials saved.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
