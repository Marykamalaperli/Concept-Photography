import assert from 'node:assert/strict';
import test from 'node:test';
import { dayStart } from '../lib/hr-policy.js';
import { dailyHours } from '../lib/work-hours.js';
import { createWorksheetViews } from '../public/worksheet-views.js';

const minute = 60_000;
const date = '2026-11-30';
const at = (hour, minutes = 0) => dayStart(date) + (hour * 60 + minutes) * minute;
const settings = { week_off: 0, required_minutes: 480, work_start: '09:00', work_end: '18:00' };
const employee = { employment_start: '2026-01-01' };
const shift = (start, end, taskId = null) => ({ clock_in: start, clock_out: end, site: JSON.stringify({ taskId }) });
const period = (kind, start, end) => ({ kind, start_at: start, end_at: end });

test('work hours subtract breaks, fill only official travel and avoid counting overlapping intervals twice', () => {
  const result = dailyHours({
    date, now: at(20), employee, settings, holidays: [],
    attendance: [shift(at(9, 10), at(12)), shift(at(14), at(17), 17), shift(at(14, 15), at(14, 30), 17)],
    periods: [period('personal', at(10), at(10, 20)), period('lunch', at(11, 45), at(12, 30)), period('travel', at(12, 45), at(14, 15))],
  });
  assert.equal(result.actual / minute, 390);
  assert.equal(result.remaining / minute, 90);
  assert.equal(result.office / minute, 135);
  assert.equal(result.shoot / minute, 180);
  assert.equal(result.extraTravel / minute, 75);
  assert.equal(result.travel / minute, 90);
  assert.equal(result.away / minute, 15);
  assert.equal(result.late / minute, 10);
  assert.equal(result.early / minute, 60);
});

test('approved leave, holidays and time corrections apply without fabricating a GPS reading', () => {
  const input = { date, now: at(20), employee, settings, holidays: [], attendance: [], periods: [] };
  const correction = { kind: 'time', status: 'approved', day_from: date, clock_in: at(8), clock_out: at(17) };
  const leave = { kind: 'leave', status: 'approved', day_from: date, day_to: date, leave_type: 'half' };
  const result = dailyHours({ ...input, requests: [correction, leave] });
  assert.equal(result.required / minute, 240);
  assert.equal(result.actual / minute, 540);
  assert.equal(result.office, 0);
  assert.equal(result.adjustment, result.actual);
  assert.equal(result.overtime / minute, 300);
  assert.equal(result.early, null);
  assert.equal(dailyHours({ ...input, holidays: [{ day: date }] }).required, 0);
});

test('open work periods affect only the dates they overlap', () => {
  const followingDay = 24 * 60 * minute;
  const input = { date, now: at(12) + followingDay, employee, settings, holidays: [],
    attendance: [shift(at(9), at(17))] };
  const historical = dailyHours({ ...input, periods: [period('travel', at(9) + followingDay, null)] });
  assert.equal(historical.out, at(17));
  assert.equal(historical.early, 60 * minute);
  assert.equal(historical.travel, 0);

  const overnight = dailyHours({ ...input, periods: [period('travel', at(23), null)] });
  assert.equal(overnight.out, null);
  assert.equal(overnight.travel, 60 * minute);
});

test('worksheet filter edits survive a redraw and clear when the session is reset', () => {
  const worksheet = createWorksheetViews({
    actor: () => ({ id: 7 }), manager: () => false, today: () => date,
    e: (value) => value, heading: () => '', empty: () => '', entryForm: (_kind, fields) => fields,
  });
  worksheet.rememberFilters({ elements: { date: { value: '2026-11-27' }, period: { value: 'week' } } });
  assert.match(worksheet.page(), /value="2026-11-27"/);
  assert.match(worksheet.page(), /value="week" selected/);
  assert.deepEqual(worksheet.scope(), { employeeId: 7, date, period: 'day' });
  worksheet.reset();
  assert.match(worksheet.page(), /value="day" selected/);
});

test('performance compares eligible work and skips approval, GPS, travel and revised schedule exceptions', async () => {
  const { summarizeWork } = await import('../lib/performance.js');
  const tracked = { id: 1, title: 'Assigned editing', category: 'Editing', assigned: 1, start_at: at(9), estimate: 60,
    work_state: 'ready', shoot_status: 'booked', completed_at: at(10) };
  const task = (id, hour, extra = {}) => ({ ...tracked, id, start_at: at(hour), completed_at: null, ...extra });
  const report = {
    start: at(0), end: at(23), now: at(23), to: date,
    days: [{ date, actual: 450 * minute, overtime: 0, lunch: 30 * minute, personal: 10 * minute, travel: 60 * minute, approvedLeave: 0, in: at(9) }],
    tasks: [
      tracked, task(2, 11, { pending_change: 1 }), task(3, 12), task(4, 13), task(5, 14, { schedule_changed: 1 }),
      task(6, 15, { category: 'Photo shoot' }), task(7, 16),
    ],
    sessions: [{ task_id: 1, start_at: at(9, 30), end_at: at(10, 30) }],
    gaps: [{ start_at: at(12, 10), resolved_at: at(12, 20) }],
    periods: [{ kind: 'travel', start_at: at(13, 10), end_at: at(13, 20) }],
  };
  const result = summarizeWork(report);
  assert.equal(result.completed, 1);
  assert.equal(result.eligible, 2);
  assert.equal(result.recorded, 60 * minute);
  assert.equal(result.within, 30 * minute);
  assert.equal(result.shoots, 1);
  assert.equal(result.breaks, 40 * minute);
});
