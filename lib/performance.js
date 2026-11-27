import { dayLength, dayStart, studioDay } from './hr-policy.js';

export function summarizeWork(report) {
  const totals = report.days.reduce((sums, day) => {
    sums.work += day.actual;
    sums.overtime += day.overtime;
    sums.breaks += day.lunch + day.personal;
    sums.travel += day.travel;
    sums.leaveDays += day.approvedLeave;
    if (day.in != null) sums.attendanceDays++;
    return sums;
  }, { work: 0, overtime: 0, breaks: 0, travel: 0, leaveDays: 0, attendanceDays: 0 });
  let eligible = 0;
  let completed = 0;
  let verifiedSchedules = 0;
  let recorded = 0;
  let within = 0;
  for (const task of report.tasks) {
    const end = task.start_at + task.estimate * 60_000;
    const due = task.assigned && !task.is_unscheduled && task.shoot_status === 'booked' && task.start_at < report.end && end > report.start && end <= report.now;
    if (!due || task.category === 'Photo shoot' || task.work_state !== 'ready' || task.blocked_reason || task.pending_change || task.schedule_changed) continue;
    const affectedDates = report.days.filter((day) => {
      const start = dayStart(day.date);
      return start < end && start + dayLength > task.start_at;
    });
    const gap = report.gaps.some((entry) => entry.start_at < end && (entry.resolved_at ?? report.now) > task.start_at);
    const travel = report.periods.some((entry) => entry.kind === 'travel' && entry.start_at < end && (entry.end_at ?? report.now) > task.start_at);
    if (gap || travel || affectedDates.some((day) => day.approvedLeave > 0)) continue;
    eligible++;
    if (task.completed_at && task.completed_at <= report.now && studioDay(task.completed_at) <= report.to) completed++;
    const sessions = report.sessions.filter((row) => row.task_id === task.id && row.end_at != null);
    if (!sessions.length) continue;
    verifiedSchedules++;
    for (const session of sessions) {
      const start = Math.max(session.start_at, report.start);
      const stop = Math.min(session.end_at, report.end);
      recorded += Math.max(0, stop - start);
      within += Math.max(0, Math.min(stop, end) - Math.max(start, task.start_at));
    }
  }
  return {
    ...totals, eligible, completed, verifiedSchedules, recorded, within,
    shoots: report.tasks.filter((task) => task.category === 'Photo shoot' && task.shoot_status === 'booked').length,
  };
}
