const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const studioDay = (timestamp) => dateFormat.format(timestamp);
export const dayStart = (date) => Date.parse(date + 'T00:00:00+05:30');
export const dayLength = 86_400_000;

export function validDay(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(dayStart(date)) && studioDay(dayStart(date)) === date;
}

export function dateRange(from, to) {
  const dates = [];
  for (let timestamp = dayStart(from); timestamp <= dayStart(to); timestamp += dayLength) {
    dates.push(studioDay(timestamp));
  }
  return dates;
}

export const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
export const isDayOff = (date, settings, holidays) =>
  weekday(date) === settings.week_off || holidays.some((holiday) => holiday.day === date);

export function leaveDays(request, settings, holidays) {
  return dateRange(request.day_from, request.day_to).filter((date) => !isDayOff(date, settings, holidays));
}

export function leaveLedger(requests, person, settings, holidays) {
  const days = new Map();
  const used = new Map();
  const approved = requests.filter((request) => request.kind === 'leave' && request.status === 'approved' && request.employee_id === person.id);
  const entries = approved.flatMap((request) => leaveDays(request, settings, holidays).map((date) => ({ request, date })));
  entries.sort((first, second) => first.date.localeCompare(second.date));
  const earned = (date) => {
    if (person.employment_start && date < person.employment_start) return 0;
    const [year, month] = date.split('-').map(Number);
    const [hiredYear, hiredMonth] = (person.employment_start ?? '').split('-').map(Number);
    return (month - (year === hiredYear ? hiredMonth - 1 : 0)) * settings.monthly_leave;
  };
  for (const { request, date } of entries) {
    const year = date.slice(0, 4);
    const units = request.leave_type === 'half' ? 0.5 : 1;
    const consumed = used.get(year) ?? 0;
    const paid = request.leave_type === 'unpaid' ? 0 : Math.min(units, Math.max(0, earned(date) - consumed));
    used.set(year, consumed + paid);
    days.set(date, { units, paid, unpaid: units - paid });
  }
  return {
    days,
    balance(date) {
      const entitlement = earned(date);
      const used = [...days].reduce((total, [day, leave]) => day.slice(0, 4) === date.slice(0, 4) && day <= date ? total + leave.paid : total, 0);
      return { earned: entitlement, used, available: Math.max(0, entitlement - used) };
    },
  };
}

export function timeForDay(records, date, now, correction) {
  const start = dayStart(date);
  const end = start + dayLength;
  const intervals = records.filter((record) => record.clock_in < end && (record.clock_out ?? now) >= start)
    .map((record) => ({
      in: Math.max(start, record.clock_in),
      out: Math.min(end, record.clock_out ?? now),
      running: record.clock_out === null && now < end,
    })).sort((a, b) => a.in - b.in);
  const first = intervals[0];
  const last = intervals.at(-1);
  if (!last) {
    return { in: correction?.clock_in, out: correction?.clock_out, total: correction?.clock_in != null && correction?.clock_out != null
      ? correction.clock_out - correction.clock_in : 0 };
  }
  const startAt = correction?.clock_in ?? first.in;
  const endAt = correction?.clock_out ?? last.out;
  let total = intervals.reduce((sum, interval) => sum + Math.max(0, Math.min(interval.out, endAt) - Math.max(interval.in, startAt)), 0);
  if (startAt < first.in) total += Math.max(0, Math.min(first.in, endAt) - startAt);
  if (endAt > last.out) total += Math.max(0, endAt - Math.max(last.out, startAt));
  return { in: startAt, out: last.running && correction?.clock_out == null ? null : endAt, total: Math.max(0, total) };
}
