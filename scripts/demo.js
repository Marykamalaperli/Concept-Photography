import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../lib/accounts.js';
import { dayLength, dayStart, studioDay } from '../lib/hr-policy.js';
import { openStore } from '../store.js';

export async function seedDemo(database, { scale = 1, now = Date.now() } = {}) {
  if (!Number.isInteger(scale) || scale < 1 || scale > 20) throw new Error('Choose a demo scale from 1 to 20.');
  // The caller creates a new private directory before seeding.
  const db = openStore(new DatabaseSync(database));
  try {
    if (db.prepare('SELECT 1 FROM employees LIMIT 1').get()) throw new Error('Choose an empty demonstration database.');
    const logins = [['manager@studio.example.invalid', 'Rehearsal Manager', randomBytes(16).toString('base64url')],
      ['photographer@studio.example.invalid', 'Rehearsal Photographer', randomBytes(16).toString('base64url')]];
    const hashes = await Promise.all(logins.map(([, , password]) => hashPassword(password)));
    const today = studioDay(now);
    const midnight = dayStart(today);
    const startOfEmployment = studioDay(midnight - 120 * dayLength);
    db.exec('BEGIN IMMEDIATE');
    try {
      const addEmployee = db.prepare(`
        INSERT INTO employees (id, name, email, role, color, is_admin, password_hash, employment_start, permission_role) VALUES (?,?,?,?,?,?,?,?,?)
      `);
      addEmployee.run(1, logins[0][1], logins[0][0], 'Administrator', 'peach', 1, hashes[0], startOfEmployment, 'General Employee');
      addEmployee.run(2, logins[1][1], logins[1][0], 'Photographer', 'sage', 0, hashes[1], startOfEmployment, 'Photographer');
      for (let id = 3; id <= Math.max(5, scale * 4); id++) {
        addEmployee.run(id, 'Rehearsal crew ' + id, 'crew-' + id + '@studio.example.invalid', 'Editor', 'lavender', 0, null, startOfEmployment, 'Video Editor');
      }
      db.exec(`
        INSERT INTO office(id,name,latitude,longitude,address) VALUES(1,'Rehearsal studio',17.44,78.39,'Synthetic office pin');
        UPDATE hr_settings SET storage_manager_id = 2 WHERE id = 1;
      `);
      const addClient = db.prepare("INSERT INTO clients (id,name,phone,email,category) VALUES(?,?,?,?, 'Commercial')");
      const addProject = db.prepare("INSERT INTO projects (id,client_id,name,category,created_at) VALUES(?,?,?,'Commercial photography',?)");
      const addShoot = db.prepare(`
        INSERT INTO tasks(id,title,employee_id,start_at,estimate,location,category,site_latitude,site_longitude,
          completed_at,client_id,income_paise,project_id,priority,payment_due_on)
        VALUES(?,?,2,?,180,'Rehearsal location','Photo shoot',17.442,78.392,?,?,1800000,?,1,?)
      `);
      const addReceipt = db.prepare("INSERT INTO payments(task_id,amount_paise,paid_on,category) VALUES(?,900000,?,'Deposit')");
      const addExpense = db.prepare("INSERT INTO expenses(name,category,amount_paise,spent_on) VALUES(?,'Transport',120000,?)");
      const sales = ['Product catalogue', 'Studio portraits', 'Editorial collection', 'Retail launch', 'Food styling', 'Location portraits'];
      for (let i = 1; i <= scale * 24; i++) {
        const label = sales[(i - 1) % sales.length] + (i > sales.length ? ' · ' + i : '');
        const time = midnight + (i % 5 === 0 ? 5 : -(i % 70)) * dayLength + 10 * 3_600_000;
        const completed = time + 3 * 3_600_000 < now ? time + 3 * 3_600_000 : null;
        addClient.run(i, 'Rehearsal client ' + i, String(9000000000 + i), 'client-' + i + '@studio.example.invalid');
        addProject.run(i, i, label, Math.min(time, now));
        addShoot.run(i, label, time, completed, i, i, studioDay(time + 3 * dayLength));
        addReceipt.run(i, studioDay(Math.min(time, now)));
        if (i % 3 === 0) addExpense.run('Location travel · ' + i, studioDay(Math.min(time, now)));
      }
      const finished = db.prepare("SELECT id FROM tasks WHERE completed_at IS NOT NULL AND category = 'Photo shoot' ORDER BY completed_at DESC LIMIT 1").get();
      if (finished) {
        db.prepare("INSERT INTO revenue_allocations(shoot_id,employee_id,amount_paise,updated_by,updated_at) VALUES(?,2,720000,1,?)").run(finished.id, now);
        const verifyTask = db.prepare(`
          INSERT INTO tasks(title,employee_id,start_at,estimate,location,category,is_unscheduled)
          VALUES('Confirm the footage backup',2,?,30,'Studio storage','Studio',1) RETURNING id
        `).get(midnight);
        db.prepare("INSERT INTO footage_checks(shoot_id,task_id,assigned_to,status,created_at) VALUES(?,?,2,'assigned',?)").run(finished.id, verifyTask.id, now);
      }
      db.prepare(`
        INSERT INTO tasks(title,employee_id,start_at,estimate,location,category,priority,acknowledged_at)
        VALUES('Prepare the portrait shortlist',2,?,75,'Rehearsal studio','Editing',1,?)
      `).run(now, now);
      const working = db.prepare("SELECT id FROM tasks WHERE title = 'Prepare the portrait shortlist'").get().id;
      db.prepare('INSERT INTO task_sessions(task_id,employee_id,start_at) VALUES(?,2,?)').run(working, now - 22 * 60_000);
      const site = JSON.stringify({ name: 'Rehearsal studio', latitude: 17.44, longitude: 78.39, radius: 100, maxAccuracy: 50 });
      const addAttendance = db.prepare('INSERT INTO attendance(employee_id,clock_in,clock_out,site,in_location,in_reason,last_verified_at,out_reason) VALUES(2,?,?,?,?,?,?,?)');
      for (let i = 1; i <= 14; i++) {
        const start = midnight - i * dayLength + 9 * 3_600_000;
        addAttendance.run(start, start + 8 * 3_600_000, site, site, 'manual', start + 8 * 3_600_000, 'manual');
      }
      addAttendance.run(now - 45 * 60_000, null, site, site, 'manual', now, null);
      db.prepare("INSERT INTO hr_requests(employee_id,kind,day_from,day_to,leave_type,reason,requested_at) VALUES(2,'leave',?,?,'casual','Rehearsal leave request',?)")
        .run(studioDay(now + dayLength * 2), studioDay(now + dayLength * 2), now);
      db.prepare("INSERT INTO announcements(title,message,published_at) VALUES('Rehearsal schedule','Use these synthetic records to review studio operations.',?)").run(now);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return logins;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const scale = process.argv[2] === undefined ? 1 : Number(process.argv[2]);
  if (process.platform !== 'win32') process.umask(0o077);
  const directory = await mkdtemp(join(tmpdir(), 'concept-demo-'));
  try {
    const database = join(directory, 'rehearsal.sqlite');
    const logins = await seedDemo(database, { scale });
    for (const [email, name, password] of logins) console.log(name + ' — ' + email + ' — ' + password);
    console.log('Press Ctrl+C to stop and remove this rehearsal database.');
    const child = spawn(process.execPath, ['server.js'], { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_PATH: database, FILE_STORAGE_DIRECTORY: join(directory, 'attachments'),
        HOST: '127.0.0.1', PORT: '0', PUBLIC_ORIGIN: '', TLS_KEY_PATH: '', TLS_CERT_PATH: '', TRUST_PROXY_IP: '',
        SECURE_COOKIES: '0', ENABLE_WEB_PUSH: '0', FILE_RETENTION_DAYS: '30' } });
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => child.kill());
    await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
