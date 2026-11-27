import { dayLength, dayStart, isDayOff } from './hr-policy.js';

const minute = 60_000;

function merged(intervals) {
  const result = [];
  for (const [start, end] of intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

function subtract(intervals, excluded) {
  return merged(intervals).flatMap(([start, end]) => {
    const result = [];
    let cursor = start;
    for (const [from, to] of excluded) {
      if (from >= end) break;
      if (to <= cursor) continue;
      if (from > cursor) result.push([cursor, from]);
      cursor = Math.max(cursor, to);
    }
    if (cursor < end) result.push([cursor, end]);
    return result;
  });
}

const length = (intervals) => intervals.reduce((total, [start, end]) => total + end - start, 0);
const clockTime = (date, time) => time ? Date.parse(date + 'T' + time + ':00+05:30') : null;

export function dailyHours({ attendance = [], periods = [], requests = [], gaps = [], settings, holidays, employee, date, now }) {
  const start = dayStart(date);
  const end = Math.min(start + dayLength, now);
  const clip = (from, to) => [Math.max(start, from), Math.min(end, to ?? now)];
  const correction = requests.find((row) => row.kind === 'time' && row.status === 'approved' && row.day_from === date);
  const leave = requests.find((row) => row.kind === 'leave' && row.status === 'approved' && row.day_from <= date && row.day_to >= date);
  const required = isDayOff(date, settings, holidays) || (employee.employment_start && date < employee.employment_start) ? 0 :
    settings.required_minutes * (leave ? (leave.leave_type === 'half' ? .5 : 0) : 1) * minute;
  const shifts = attendance.filter((shift) => shift.clock_in < end && (shift.clock_out ?? now) > start);
  const reported = shifts.map((shift) => clip(shift.clock_in, shift.clock_out));
  const chronological = merged(reported);
  const first = chronological[0]?.[0];
  const last = chronological.at(-1)?.[1];
  const correctedIn = correction?.clock_in ?? first;
  const correctedOut = correction?.clock_out ?? last;
  const adjusted = correctedIn == null || correctedOut == null ? reported : chronological.length ? [
    ...chronological.map(([from, to]) => [Math.max(from, correctedIn), Math.min(to, correctedOut)]),
    clip(correctedIn, Math.min(first, correctedOut)), clip(Math.max(last, correctedIn), correctedOut),
  ] : [clip(correctedIn, correctedOut)];

  const workPeriods = (kind) => merged(periods.filter((row) => row.kind === kind).map((row) => clip(row.start_at, row.end_at)));
  const lunch = workPeriods('lunch');
  const personal = workPeriods('personal');
  const breaks = merged([...lunch, ...(settings.personal_break_paid ? [] : personal)]);
  const onsite = subtract(adjusted, breaks);
  const officialTravel = subtract(workPeriods('travel'), breaks);
  const extraTravel = settings.travel_paid === 0 ? [] : subtract(officialTravel, onsite);
  const combined = merged([...onsite, ...extraTravel]);
  const actual = length(combined);

  const siteIntervals = (shoot) => shifts.filter((shift) => {
    const site = shift.site ? JSON.parse(shift.site) : null;
    return shoot ? Boolean(site?.taskId) : Boolean(site && !site.taskId);
  }).map((shift) => {
    const [from, to] = clip(shift.clock_in, shift.clock_out);
    return [Math.max(from, correctedIn ?? from), Math.min(to, correctedOut ?? to)];
  });
  const shoot = subtract(siteIntervals(true), breaks);
  const office = subtract(siteIntervals(false), merged([...breaks, ...shoot]));
  const firstWork = combined[0]?.[0];
  const lastWork = combined.at(-1)?.[1];
  const open = shifts.some((shift) => shift.clock_out == null) || periods.some((period) => period.end_at == null);
  const expectedStart = clockTime(date, settings.work_start);
  const expectedEnd = clockTime(date, settings.work_end);
  const halfDay = leave?.leave_type === 'half';
  const unverified = merged([
    ...gaps.map((row) => clip(row.start_at, row.resolved_at)),
    ...shifts.filter((shift) => ['employee-reported', 'offline-reported'].includes(shift.out_reason))
      .map((shift) => clip(shift.last_verified_at ?? shift.clock_in, shift.clock_out)),
  ]);
  return {
    required, actual, remaining: Math.max(0, required - actual), overtime: Math.max(0, actual - required - (settings.overtime_grace_minutes ?? 0) * minute),
    verificationUncertain: length(onsite) - length(subtract(onsite, unverified)),
    office: length(office), shoot: length(shoot), travel: length(officialTravel), extraTravel: length(extraTravel),
    lunch: length(lunch), personal: length(personal), adjustment: length(onsite) - length(office) - length(shoot),
    away: firstWork == null ? 0 : Math.max(0, lastWork - firstWork - length(merged([...combined, ...breaks.map(([a, b]) => [Math.max(a, firstWork), Math.min(b, lastWork)])]))),
    in: correctedIn ?? null, out: open && correction?.clock_out == null ? null : correctedOut ?? null,
    late: required && !halfDay && expectedStart && firstWork != null ? Math.max(0, firstWork - expectedStart) : null,
    early: required && !halfDay && expectedEnd && !open && lastWork != null ? Math.max(0, expectedEnd - lastWork) : null,
    corrected: Boolean(correction),
  };
}
