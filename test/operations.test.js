import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hashPassword } from '../lib/accounts.js';
import { dayLength, dayStart, studioDay } from '../lib/hr-policy.js';
import { refreshStudioNotices } from '../lib/studio-notices.js';
import { createApi } from '../lib/workspace-api.js';
import { sqliteAdapter } from '../sqlite-adapter.js';
import { openStore } from '../store.js';

const minute = 60_000;
const password = 'Synthetic test passphrase';
const future = studioDay(Date.now() + 3 * dayLength);
const iso = (time) => future + 'T' + time + ':00+05:30';

async function fixture(t) {
  const raw = openStore(new DatabaseSync(':memory:'));
  t.after(() => raw.close());
  const db = sqliteAdapter(raw);
  const hash = await hashPassword(password);
  for (const [id, name, manager] of [[1, 'Owner', 1], [2, 'Editor', 0], [3, 'Photographer', 0]]) {
    await db.run(`
      INSERT INTO employees(id, name, role, email, color, is_admin, password_hash)
      VALUES (?, ?, ?, ?, 'sage', ?, ?)
    `, id, name, name, name.toLowerCase() + '@example.invalid', manager, hash);
  }
  const api = createApi(db);
  async function signIn(name) {
    let cookie;
    async function call(path, body) {
      const headers = { 'content-type': 'application/json', cookie };
      const request = {
        method: body === undefined ? 'GET' : 'POST', socket: { remoteAddress: '127.0.0.1' }, headers,
        async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
      };
      return api(request, { setHeader(_name, header) { cookie = header.split(';')[0]; } }, '/api/' + path);
    }
    await call('login', { email: name + '@example.invalid', password });
    return call;
  }
  return { db, manager: await signIn('owner'), staff: await signIn('editor'), other: await signIn('photographer') };
}

function planned(title, from = '09:00', to = '10:00') {
  return { title, from, to, location: 'Studio', category: 'Editing' };
}

test('submitted plans are role-scoped and locked, with revisions and completion review', async (t) => {
  const { db, manager, staff, other } = await fixture(t);
  const draft = await staff('operations/plan', { date: future, entries: [planned('First cut')] });
  assert.equal(draft.status, 'draft');
  await assert.rejects(staff('operations/plan', { date: future, id: draft.id, entries: [
    planned('First cut'), planned('Overlap', '09:50', '10:10'),
  ] }), { status: 400 });
  await staff('operations/submit-plan', { id: draft.id });
  await assert.rejects(other('operations/submit-plan', { id: draft.id }), { status: 404 });
  await assert.rejects(staff('operations/review-plan', { id: draft.id, decision: 'approved' }), { status: 403 });
  await assert.rejects(staff('operations/plan', { date: future, id: draft.id, entries: [planned('Replacement')] }), { status: 409 });
  await manager('operations/review-plan', { id: draft.id, decision: 'approved' });
  await assert.rejects(staff('tasks', { title: 'Direct change', category: 'Editing', location: 'Studio', startAt: iso('11:00'), estimate: 30 }), { status: 409 });
  const revision = await staff('operations/plan', { date: future, reason: 'New client deadline', entries: [planned('Revised cut')] });
  await staff('operations/submit-plan', { id: revision.id });
  await manager('operations/review-plan', { id: revision.id, decision: 'approved' });
  assert.equal((await db.get('SELECT status FROM daily_plans WHERE id = ?', draft.id)).status, 'superseded');
  assert.equal((await db.get('SELECT shoot_status FROM tasks WHERE daily_plan_id = ?', draft.id)).shoot_status, 'cancelled');
  const staffState = await staff('state');
  assert.equal((await other('state')).plans.length, 0);
  assert.ok(staffState.operationNotices.some((row) => row.title === 'Daily plan approved'));
  const { id: taskId } = staffState.tasks.find((row) => row.daily_plan_id === revision.id);
  await assert.rejects(staff('task-action', { taskId, action: 'start' }), { status: 409 });
  await staff('task-action', { taskId, action: 'acknowledge' });
  await staff('task-action', { taskId, action: 'start' });
  await assert.rejects(staff('task-action', { taskId, action: 'complete' }), { status: 409 });
  await staff('task-action', { taskId, action: 'pause' });
  await staff('task-action', { taskId, action: 'start' });
  await staff('task-action', { taskId, action: 'submit-completion', report: 'Export checked against the brief.' });
  await assert.rejects(staff('operations/completion', { taskId, decision: 'approve' }), { status: 403 });
  await manager('operations/completion', { taskId, decision: 'return', note: 'Check the title sequence.' });
  await staff('task-action', { taskId, action: 'submit-completion', report: 'Corrected and rechecked.' });
  await manager('operations/completion', { taskId, decision: 'approve' });
  assert.ok((await db.get('SELECT completed_at FROM tasks WHERE id = ?', taskId)).completed_at);
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM task_sessions WHERE task_id = ? AND end_at IS NOT NULL', taskId)).total, 2);
  assert.ok((await manager('operations/audit')).some((event) => event.action === 'completion approved'));
  await assert.rejects(staff('operations/audit'), { status: 403 });
});

test('an emergency shoot pauses only affected work and preserves timings through an approved reschedule', async (t) => {
  const { db, manager, staff, other } = await fixture(t);
  const first = await manager('tasks', { employeeId: 2, title: 'Colour grade', category: 'Editing', location: 'Studio', startAt: iso('09:00'), estimate: 60 });
  await staff('task-action', { taskId: first.id, action: 'start' });
  const input = {
    employeeId: 2, title: 'Urgent pickup shoot', category: 'Photo shoot', location: 'Studio annex',
    startAt: iso('09:15'), endAt: iso('09:45'), clientName: 'Synthetic client', clientPhone: '9000000000',
    latitude: 17.38, longitude: 78.48, income: '200', emergency: true,
  };
  const unrelated = await manager('tasks', { employeeId: 3, title: 'Unaffected edit', category: 'Editing', location: 'Studio', startAt: iso('09:00'), estimate: 60 });
  let conflict;
  await assert.rejects(manager('tasks', input), (error) => {
    conflict = error.conflicts.find((row) => row.id === first.id);
    return error.status === 409 && Boolean(conflict);
  });
  const shoot = await manager('tasks', { ...input, acknowledgedConflicts: [conflict.key] });
  assert.equal(shoot.emergency, 1);
  assert.equal((await db.get('SELECT work_state FROM tasks WHERE id = ?', first.id)).work_state, 'reschedule');
  assert.equal((await db.get('SELECT work_state FROM tasks WHERE id = ?', unrelated.id)).work_state, 'ready');
  assert.ok((await db.get('SELECT end_at FROM task_sessions WHERE task_id = ?', first.id)).end_at);
  const request = { taskId: first.id, kind: 'reschedule', start: iso('10:30'), reason: 'Priority shoot' };
  await assert.rejects(other('operations/task-change', request), { status: 404 });
  const change = await staff('operations/task-change', request);
  await assert.rejects(staff('operations/task-change', request), { status: 409 });
  await manager('operations/review-change', { id: change.id, decision: 'approved' });
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', first.id);
  assert.equal(task.start_at, Date.parse(iso('10:30')));
  assert.equal(task.work_state, 'ready');
  const audit = await manager('operations/audit');
  assert.ok(audit.some((event) => event.action === 'displaced by emergency shoot' &&
    JSON.parse(event.details).originalStart === Date.parse(iso('09:00'))));
  assert.ok((await staff('state')).operationNotices.some((row) => row.title === 'Task needs rescheduling'));
});

test('task and next-working-day reminders deduplicate and use the office calendar', async (t) => {
  const { db } = await fixture(t);
  const day = '2026-11-28';
  const start = dayStart(day);
  await db.run("INSERT INTO holidays(day, name) VALUES ('2026-11-30', 'Studio closure')");
  await db.run(`
    INSERT INTO tasks(title, employee_id, start_at, estimate, location, category)
    VALUES ('Morning edit', 2, ?, 60, 'Studio', 'Editing')
  `, start + 9 * 60 * minute);
  const reminder = start + (9 * 60 + 40) * minute;
  await refreshStudioNotices(db, reminder);
  await refreshStudioNotices(db, reminder);
  assert.equal((await db.get("SELECT COUNT(*) AS total FROM operation_notices WHERE title = 'Task finishes soon'")).total, 1);
  const closing = start + 18 * 60 * minute;
  await refreshStudioNotices(db, closing);
  await refreshStudioNotices(db, closing + minute);
  assert.equal((await db.get("SELECT COUNT(*) AS total FROM operation_notices WHERE employee_id = 2 AND event_key = 'late-next:2026-12-01'")).total, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS total FROM operation_notices WHERE title = 'Employee has no scheduled work'")).total, 1);
});

test('work periods, worksheet access and ending a shift without GPS use actual records', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-27T14:00:00+05:30') });
  const { db, manager, staff, other } = await fixture(t);
  const now = Date.now();
  const date = studioDay(now);
  const start = dayStart(date);
  await db.run('UPDATE hr_settings SET week_off = ?, required_minutes = 480 WHERE id = 1', (new Date(start + 12 * 60 * minute).getUTCDay() + 1) % 7);
  const site = JSON.stringify({ name: 'Office', latitude: 17.38, longitude: 78.48 });
  const shift = await db.get(`
    INSERT INTO attendance(employee_id, clock_in, in_location, site, in_reason, last_verified_at)
    VALUES (2, ?, ?, ?, 'manual', ?) RETURNING *
  `, now - 95 * minute, site, site, now - 10 * minute);
  const lunch = await staff('attendance/period', { action: 'start', kind: 'lunch', note: 'Meal break' });
  await assert.rejects(other('attendance/period', { action: 'end', id: lunch.id }), { status: 409 });
  await assert.rejects(staff('attendance/period', { action: 'start', kind: 'personal' }), { status: 409 });
  await db.run('UPDATE work_periods SET start_at = ? WHERE id = ?', now - 20 * minute, lunch.id);
  await staff('attendance/period', { action: 'end', id: lunch.id });
  const shoot = await db.get(`
    INSERT INTO tasks(title, employee_id, start_at, estimate, location, category)
    VALUES ('Work trip', 2, ?, 60, 'Shoot site', 'Photo shoot') RETURNING *
  `, now);
  await assert.rejects(staff('attendance/period', { action: 'start', kind: 'travel', taskId: shoot.id + 1 }), { status: 409 });
  const trip = await staff('attendance/period', { action: 'start', kind: 'travel', taskId: shoot.id });
  await db.run('INSERT INTO attendance_gaps (attendance_id, start_at) VALUES (?, ?)', shift.id, now - 5 * minute);
  await assert.rejects(staff('worksheet', { date, period: 'day', employeeId: 3 }), { status: 403 });
  const review = await staff('attendance', { action: 'end-shift', shiftId: shift.id });
  assert.equal(review.location_unverified, 1);
  assert.equal(review.status, 'pending');
  assert.ok(review.next_plan_day);
  const recorded = await db.get('SELECT * FROM attendance WHERE id = ?', shift.id);
  assert.equal(recorded.out_location, null);
  assert.equal(recorded.out_reason, 'employee-reported');
  assert.equal(recorded.resume_pending, 0);
  assert.ok((await db.get('SELECT end_at FROM work_periods WHERE id = ?', trip.id)).end_at);
  assert.ok((await db.get('SELECT resolved_at FROM attendance_gaps WHERE attendance_id = ?', shift.id)).resolved_at);
  assert.equal((await staff('attendance', { action: 'end-shift', shiftId: shift.id })).id, review.id);
  await assert.rejects(staff('attendance/review-shift', { id: review.id, status: 'accepted', note: 'Recorded' }), { status: 403 });
  await manager('attendance/review-shift', { id: review.id, status: 'accepted', note: 'Reviewed by the office' });
  await staff('worksheet/remark', { date, remark: '=example' });
  await manager('worksheet/remark', { date, employeeId: 2, remark: 'Same day review' });
  const sheet = await manager('worksheet', { date, period: 'day', employeeId: 2 });
  assert.deepEqual(sheet.remarks.map((row) => row.scope).sort(), ['admin', 'employee']);
  assert.equal(sheet.reviews[0].status, 'accepted');
  assert.ok(sheet.days[0].actual >= 60 * minute && sheet.days[0].actual < 80 * minute);
  assert.equal(sheet.days[0].extraTravel, 0);
  assert.equal(sheet.corrections.length, 0);
  assert.ok((await staff('worksheet', { date, period: 'month' })).days.length >= 1);
});


test('additional office pins and GPS accuracy settings authorize only matching readings', async (t) => {
  const { manager, staff } = await fixture(t);
  const annex = { name: 'Annex', latitude: 17.39, longitude: 78.48 };
  const office = { name: 'Office', address: 'Studio building', latitude: 17.38, longitude: 78.48 };
  await manager('office', { ...office, additionalSites: [annex] });
  await assert.rejects(manager('office', { ...office, additionalSites: [office] }), { status: 400 });
  await manager('hr/settings', { weekOff: 0, monthlyLeave: 2, officeRadius: 60, shootRadius: 80, maxAccuracy: 25 });
  await assert.rejects(staff('hr/settings', { weekOff: 0, monthlyLeave: 2, officeRadius: 75 }), { status: 403 });
  await assert.rejects(staff('attendance', { action: 'in', location: { ...annex, accuracy: 30, capturedAt: Date.now() } }), { status: 422 });
  await assert.rejects(staff('attendance', { action: 'in', location: { ...annex, latitude: 17.39063, accuracy: 5, capturedAt: Date.now() } }), { status: 422 });
  const shift = await staff('attendance', { action: 'in', location: { ...annex, accuracy: 10, capturedAt: Date.now() } });
  assert.equal(JSON.parse(shift.site).name, 'Annex');
  assert.equal(JSON.parse(shift.site).radius, 60);
  assert.equal(JSON.parse(shift.site).maxAccuracy, 25);
});

test('completed shoots queue one private footage verification and require storage-manager evidence plus approval', async (t) => {
  const { db, manager, staff, other } = await fixture(t);
  const shoot = await manager('tasks', {
    employeeId: 3, title: 'Studio shoot', category: 'Photo shoot', location: 'Studio',
    startAt: iso('08:00'), endAt: iso('09:00'), clientName: 'Synthetic client', clientPhone: '9000000000',
    latitude: 17.38, longitude: 78.48, income: '200',
  });
  await manager('shoot-done', { taskId: shoot.id });
  await assert.rejects(manager('shoot-done', { taskId: shoot.id }), { status: 409 });
  const initial = (await manager('state')).footageChecks[0];
  assert.equal(initial.status, 'unassigned');
  assert.equal((await staff('state')).footageChecks.length, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS total FROM footage_checks WHERE shoot_id = ?', shoot.id)).total, 1);
  await assert.rejects(other('footage/manager', { employeeId: 3 }), { status: 403 });
  await assert.rejects(manager('footage/manager', { employeeId: 1 }), { status: 400 });
  await manager('footage/manager', { employeeId: 2 });
  const check = (await staff('state')).footageChecks[0];
  assert.equal(check.status, 'assigned');
  assert.equal(check.shoot_id, shoot.id);
  assert.equal(check.client_name, 'Synthetic client');
  assert.ok(check.task_id);
  assert.equal((await other('state')).footageChecks.length, 0);
  await assert.rejects(staff('task-action', { taskId: check.task_id, action: 'complete' }), { status: 409 });
  await assert.rejects(staff('operations/task-change', { taskId: check.task_id, kind: 'extension', minutes: 10, reason: 'Request' }), { status: 409 });
  await assert.rejects(other('footage/submit', { id: check.id, incident: 'missing', note: 'Test' }), { status: 404 });
  await staff('footage/submit', { id: check.id, incident: 'missing', note: 'Drive not delivered' });
  await assert.rejects(manager('footage/review', { id: check.id, status: 'approved' }), { status: 409 });
  await manager('footage/review', { id: check.id, status: 'returned', note: 'Check the backup drive.' });
  const proof = { id: check.id, drive: 'D:', folder: 'Projects/Shoot A', backup: 'Drive B/Shoot A', transferred: true, stored: true };
  await assert.rejects(staff('footage/submit', proof), { status: 400 });
  const screenshotId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  await db.run(`
    INSERT INTO private_files(id, kind, record_id, uploaded_by, name, media_type, byte_length, sha256, created_at)
    VALUES (?, 'task', ?, 2, 'evidence.png', 'image/png', 512, ?, ?)
  `, screenshotId, check.task_id, '0'.repeat(64), Date.now());
  await staff('footage/submit', { ...proof, screenshotId });
  await assert.rejects(manager('operations/completion', { taskId: check.task_id, decision: 'approve' }), { status: 409 });
  await assert.rejects(staff('footage/review', { id: check.id, status: 'approved' }), { status: 403 });
  await manager('footage/review', { id: check.id, status: 'approved' });
  const state = await manager('state');
  assert.equal(state.footageChecks[0].status, 'approved');
  assert.equal(state.tasks.find((task) => task.id === shoot.id).footage_status, 'approved');
  assert.ok(state.tasks.find((task) => task.id === check.task_id).completed_at);
  assert.ok((await staff('state')).operationNotices.some((note) => note.title === 'Footage verification approved'));
  await manager('footage/manager', { employeeId: 3 });
  assert.equal((await staff('state')).footageChecks[0].status, 'approved');
  assert.equal((await other('state')).footageChecks.length, 0);
});

test('completed shoot allocations use integer paise and never change company booked or cash totals', async (t) => {
  const { db, manager, staff, other } = await fixture(t);
  const shoot = await manager('tasks', {
    employeeId: 2, crew: [3], title: 'Completed shoot', category: 'Photo shoot', location: 'Studio',
    startAt: iso('12:00'), endAt: iso('13:00'), income: '100.01',
    clientName: 'Studio client', clientPhone: '9000000000', latitude: 17.38, longitude: 78.48,
  });
  await assert.rejects(manager('revenue/save', { shootId: shoot.id, allocations: [] }), { status: 404 });
  await manager('shoot-done', { taskId: shoot.id });
  const date = studioDay(Date.now());
  await manager('payments', { taskId: shoot.id, amount: '25', date });
  const later = Date.now();
  await db.run('INSERT INTO task_sessions(task_id, employee_id, start_at, end_at) VALUES (?, 2, ?, ?)', shoot.id, later - 2 * 60 * minute, later);
  const part = { employeeId: 2, type: 'percent', value: '66.66' };
  await assert.rejects(staff('revenue/save', { shootId: shoot.id, allocations: [part] }), { status: 403 });
  await assert.rejects(manager('revenue/save', { shootId: shoot.id, allocations: [part, part] }), { status: 400 });
  await assert.rejects(manager('revenue/save', { shootId: shoot.id, allocations: [part, { employeeId: 3, type: 'amount', value: '50' }] }), { status: 409 });
  await manager('revenue/save', { shootId: shoot.id, allocations: [part, { employeeId: 3, type: 'amount', value: '33.35' }] });
  const allocations = await manager('revenue/allocations', { shootId: shoot.id });
  assert.equal(allocations.entries.reduce((sum, row) => sum + row.amount_paise, 0), 10001);
  await assert.rejects(other('revenue/report', { date, period: 'all', employeeId: 2 }), { status: 403 });
  for (const period of ['day', 'week', 'month', 'all']) {
    const report = await staff('revenue/report', { date, period });
    assert.equal(report.total, 6666);
    assert.equal(report.time, 2 * 60 * minute);
    assert.equal(report.perHour, 3333);
    assert.equal(report.rows.length, 1);
    assert.equal(Object.hasOwn(report.rows[0], 'income_paise'), false);
  }
  assert.equal((await manager('state')).payments[0].amount_paise, 2500);
  assert.equal((await db.get('SELECT income_paise FROM tasks WHERE id = ?', shoot.id)).income_paise, 10001);
  assert.ok((await manager('operations/audit')).some((row) => row.subject === 'revenue allocation'));
  await manager('revenue/save', { shootId: shoot.id, allocations: [] });
  assert.equal((await staff('revenue/report', { date, period: 'all' })).total, 0);
});
