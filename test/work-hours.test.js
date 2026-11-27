import assert from 'node:assert/strict';
import test from 'node:test';
import { dayStart } from '../lib/hr-policy.js';
import { dailyHours } from '../lib/work-hours.js';

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
