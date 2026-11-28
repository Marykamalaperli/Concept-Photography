const labels = { lunch: 'Lunch', personal: 'Personal break', travel: 'Shoot travel' };
const minute = 60_000;
const minutes = (elapsed) => Number((elapsed / minute).toFixed(2));
const numericFields = ['required', 'actual', 'remaining', 'overtime', 'office', 'shoot', 'travel', 'lunch', 'personal', 'away', 'late', 'early', 'verificationUncertain'];
const fieldLabels = ['Required', 'Worked', 'Remaining', 'Overtime', 'Office', 'Shoot', 'Travel', 'Lunch', 'Personal', 'Away', 'Late', 'Early', 'GPS unverified'];

export function createWorksheetViews(ui) {
  const { state, manager, actor, e, actionButton, heading, entryForm, openDialog, applyAction, empty, table, today, day, time, duration, money, chart } = ui;
  let report;
  let filters;
  let draft;
  let version = 0;

  function scope() {
    return filters ?? { employeeId: actor().id, date: today(), period: 'day' };
  }

  function timestamp(value) {
    return value == null ? '—' : day(value) + ' · ' + time(value);
  }

  function reportTable(title, columns, records, message) {
    return `<section class="panel"><div class="panel-head"><h2>${title}</h2></div>
      ${records.length ? table(title, columns, records) : empty(message)}</section>`;
  }

  function taskElapsed(id) {
    return report.sessions.filter((row) => row.task_id === id).reduce((total, row) =>
      total + Math.max(0, Math.min(report.end, row.end_at ?? report.now) - Math.max(report.start, row.start_at)), 0);
  }

  function reviewRows(rows, actionable) {
    return rows.map((row) => [
      e(row.work_day), e(row.employee_name ?? report?.employee.name),
      e(row.status), duration(row.recorded_ms), duration(row.required_ms),
      e([row.location_unverified ? 'Location unverified' : '', row.next_plan_day ? 'Plan for ' + row.next_plan_day + ' missing' : '', row.review_note]
        .filter(Boolean).join(' · ') || '—'),
      actionable && row.status !== 'accepted' ? actionButton('Review shift', 'shift-review', 'clipboard-check', 'secondary', row.id) : '—',
    ]);
  }

  function reviewTable(rows, actionable) {
    return reportTable('Shift reviews', ['Date', 'Employee', 'Status', 'Worked', 'Required', 'Review details', 'Action'],
      reviewRows(rows, actionable), 'No shift reviews for this period.');
  }

  function detail() {
    const totals = report.days.reduce((sum, row) => ({
      worked: sum.worked + row.actual, target: sum.target + row.required, overtime: sum.overtime + row.overtime,
    }), { worked: 0, target: 0, overtime: 0 });
    const hours = report.days.slice(-7).map((row) => ({ label: row.date, values: [row.actual, row.required] }));
    const durations = report.tasks.map((row) => ({ label: row.title, values: [taskElapsed(row.id), row.estimate * minute] }))
      .filter(({ values }) => values[0] > 0).slice(-6);
    const charts = [
      hours.length > 1 && chart({ title: 'Hours by day', description: 'Worked hours and target for up to seven days in this report.',
        rows: hours, series: ['Worked', 'Target'], format: duration }),
      durations.length > 1 && chart({ title: 'Task duration', description: 'Up to six tasks with time recorded in this report.',
        rows: durations, series: ['Recorded', 'Estimated'], format: duration }),
    ].filter(Boolean);
    return `<div id="worksheet-print" class="operation-stack">
      <section class="panel"><div class="panel-head"><div><h2>${e(report.employee.name)}</h2><p>${e(report.from)} to ${e(report.to)} · IST</p></div></div>
        <dl class="worksheet-totals"><div><dt>Worked</dt><dd>${duration(totals.worked)}</dd></div>
          <div><dt>Target</dt><dd>${duration(totals.target)}</dd></div><div><dt>Overtime</dt><dd>${duration(totals.overtime)}</dd></div></dl>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Work performance</h2>
          <p>Task comparisons exclude approved leave, shoot travel, GPS gaps and tasks subject to approval or revised timings.</p></div></div>
        <dl class="footage-fields">
          <div><dt>Completed tasks due in this period</dt><dd>${report.performance.completed} of ${report.performance.eligible}</dd></div>
          <div><dt>Recorded work within scheduled time</dt><dd>${report.performance.recorded ?
            Math.round(report.performance.within * 100 / report.performance.recorded) + '% across ' + report.performance.verifiedSchedules + ' tasks' : '—'}</dd></div>
          <div><dt>Days with attendance recorded</dt><dd>${report.performance.attendanceDays}</dd></div>
          <div><dt>Approved leave days</dt><dd>${report.performance.leaveDays}</dd></div>
          <div><dt>Shoot participation</dt><dd>${report.performance.shoots}</dd></div>
          <div><dt>Breaks recorded</dt><dd>${duration(report.performance.breaks)}</dd></div>
          <div><dt>Official travel</dt><dd>${duration(report.performance.travel)}</dd></div>
          <div><dt>Revenue contribution</dt><dd>${money(report.revenueContribution)}</dd></div>
        </dl>
      </section>
      ${charts.length ? `<div class="report-charts">${charts.map((item) => `<section class="panel">${item}</section>`).join('')}</div>` : ''}
      ${reportTable('Daily hours', ['Date', 'In', 'Out', ...fieldLabels, 'Policy date'], report.days.map((row) => [
        e(row.date), row.in == null ? '—' : time(row.in), row.out == null ? '—' : time(row.out),
        ...numericFields.map((key) => row[key] == null ? '—' : duration(row[key])),
        row.policyEffectiveFrom === '1900-01-01' ? 'Baseline' : e(row.policyEffectiveFrom || '—'),
      ]), 'No working hours in this period.')}
      ${reportTable('Attendance intervals', ['Check in', 'Check out', 'Site', 'Entry', 'Exit', 'Last GPS verification'],
        report.attendance.map((row) => [timestamp(row.clock_in), timestamp(row.clock_out), e(row.site ? JSON.parse(row.site).name : '—'),
          e(row.in_reason || '—'), e(row.out_reason || '—'), timestamp(row.last_verified_at)]), 'No clock-ins or check-outs recorded.')}
      ${reportTable('GPS verification gaps', ['Started', 'Resolved'], report.gaps.map((row) => [timestamp(row.start_at), timestamp(row.resolved_at)]), 'No verification interruptions.')}
      ${reportTable('Breaks and travel', ['Type', 'Start', 'End', 'Notes'], report.periods.map((row) =>
        [labels[row.kind], timestamp(row.start_at), timestamp(row.end_at), e(row.note || '—')]), 'No breaks or travel recorded.')}
      ${reportTable('Task timings', ['Task', 'Scheduled', 'Estimate', 'Recorded', 'Status'], report.tasks.map((row) =>
        [e(row.title), row.is_unscheduled ? 'Unscheduled' : timestamp(row.start_at), duration(row.estimate * minute), duration(taskElapsed(row.id)),
          e(row.completed_at ? 'Completed' : row.shoot_status !== 'booked' ? row.shoot_status : row.work_state === 'ready' ? 'Pending' : row.work_state)]), 'No assigned or tracked tasks.')}
      ${reportTable('Approved attendance corrections', ['Date', 'Check in', 'Check out', 'Reason'], report.corrections.map((row) =>
        [e(row.day_from), timestamp(row.clock_in), timestamp(row.clock_out), e(row.reason)]), 'No approved time corrections.')}
      ${reviewTable(report.reviews, manager())}
      ${reportTable('Remarks', ['Date', 'From', 'Remark'], report.remarks.map((row) => [e(row.work_day), row.scope === 'admin' ? 'Administrator' : 'Employee', e(row.remark)]), 'No remarks recorded.')}
    </div>`;
  }

  function page() {
    const chosen = draft ?? scope();
    const actions = report ? `<div class="card-actions">${actionButton('Add remark', 'worksheet-remark', 'pencil', 'secondary')}
      ${actionButton('Export CSV', 'worksheet-csv', 'download', 'secondary')}
      ${actionButton('Print or save PDF', 'worksheet-print', 'printer', 'secondary')}</div>` : '';
    return `${heading('Worksheets', 'Compare recorded hours with attendance, breaks, travel and task estimates.', actions)}
      <div class="operation-stack"><section class="panel report-filters">${entryForm('worksheet', `
        ${manager() ? `<label class="full">Employee<select name="employeeId">
          ${state().employees.map((person) => `<option value="${person.id}"${person.id === Number(chosen.employeeId) ? ' selected' : ''}>${e(person.name)}</option>`).join('')}
        </select></label>` : ''}
        <label>Date (IST)<input type="date" name="date" max="${today()}" value="${e(chosen.date)}" required></label>
        <label>Period<select name="period">${[['day','Daily'],['week','Weekly'],['month','Monthly']].map(([key, label]) =>
          `<option value="${key}"${chosen.period === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      `, 'Load worksheet', false)}</section>
      ${report ? detail() : `<section class="panel">${empty('Choose a date and reporting period, then load the worksheet.')}</section>`}</div>`;
  }

  async function load(data, request) {
    const current = ++version;
    const result = await request('worksheet', data);
    if (version !== current) return;
    filters = data;
    report = result;
    ui.render();
  }

  function rememberFilters(form) {
    const { employeeId, date, period } = form.elements;
    draft = { employeeId: employeeId?.value ?? actor().id, date: date.value, period: period.value };
  }

  function exportCsv() {
    const lines = [['Employee', 'Section', 'Date', 'Record', 'Detail', 'Value']];
    const add = (section, date, record, detail, value) => lines.push([report.employee.name, section, date, record, detail, value]);
    for (const row of report.days) {
      for (const [index, key] of numericFields.entries()) add('Hours', row.date, fieldLabels[index], 'Minutes', row[key] == null ? '' : minutes(row[key]));
      add('Hours', row.date, 'Check in', 'IST', timestamp(row.in));
      add('Hours', row.date, 'Check out', 'IST', timestamp(row.out));
    }
    for (const row of report.attendance) add('Attendance', day(row.clock_in), row.site ? JSON.parse(row.site).name : '',
      row.in_reason || '', timestamp(row.clock_in) + ' to ' + timestamp(row.clock_out) + ' · ' + (row.out_reason || 'Active'));
    for (const row of report.gaps) add('GPS', day(row.start_at), 'Verification gap', timestamp(row.start_at), timestamp(row.resolved_at));
    for (const row of report.periods) add('Break or travel', day(row.start_at), labels[row.kind], row.note || '',
      timestamp(row.start_at) + ' to ' + timestamp(row.end_at));
    for (const task of report.tasks) {
      add('Task', day(task.start_at), task.title, task.is_unscheduled ? 'Unscheduled estimate (minutes)' : 'Scheduled minutes', task.estimate);
      add('Task', day(task.start_at), task.title, 'Recorded minutes', minutes(taskElapsed(task.id)));
    }
    for (const row of report.corrections) add('Correction', row.day_from, 'Approved', row.reason, timestamp(row.clock_in) + ' to ' + timestamp(row.clock_out));
    for (const row of report.reviews) add('Shift review', row.work_day, row.status, row.review_note || '', row.next_plan_day ?? '');
    for (const row of report.remarks) add('Remark', row.work_day, row.scope, '', row.remark);
    const cell = (value) => {
      const string = String(value ?? '');
      return '"' + (/^[\s]*[=+@\-]/.test(string) ? "'" : '') + string.replaceAll('"', '""') + '"';
    };
    const file = new Blob(['\uFEFF', lines.map((line) => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'worksheet-' + report.from + '-' + report.to + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actions = {
    'worksheet-csv': exportCsv,
    'worksheet-print': () => window.print(),
    'worksheet-remark': () => openDialog('Worksheet remark', e(report.employee.name), entryForm('worksheet/remark', `
      <input type="hidden" name="employeeId" value="${report.employee.id}">
      <label class="full">Date<input name="date" type="date" min="${report.from}" max="${report.to}" value="${e(scope().date)}" required></label>
      <label class="full">Remark<textarea name="remark" maxlength="800" rows="4" required></textarea></label>`, 'Save remark')),
    'shift-review': (_button, _value, id) => openDialog('Review recorded shift', '', entryForm('attendance/review-shift', `
      <input type="hidden" name="id" value="${id}"><label class="full">Decision<select name="status"><option value="accepted">Accept</option>
        <option value="follow-up">Needs follow-up</option></select></label>
      <label class="full">Review note<textarea name="note" maxlength="800" rows="4" required></textarea></label>`, 'Save decision')),
    'end-shift': (_button, _value, id) => openDialog('End shift', '', entryForm('attendance', `
      <input type="hidden" name="shiftId" value="${id}"><input type="hidden" name="action" value="end-shift">
      <p class="full">This records your departure and stops location monitoring. If you’re offline, the workspace will show when your departure has been saved on this device.</p>`, 'End shift')),
    'period-end': (button, _value, id) => applyAction(button, 'attendance/period', { id, action: 'end' }, 'Time recorded.'),
    'period-start': (_button, kind) => {
      const now = Date.now();
      const available = ui.availableTravel().filter((task) =>
        task.start_at < now + 6 * 60 * minute && task.start_at + task.estimate * minute > now - 6 * 60 * minute);
      openDialog('Start ' + labels[kind].toLowerCase(), '', entryForm('attendance/period', `
        <input type="hidden" name="action" value="start"><input type="hidden" name="kind" value="${kind}">
        ${kind === 'travel' ? `<label class="full">Assigned shoot<select name="taskId" required><option value="">Select a shoot</option>
          ${available.map((task) => `<option value="${task.id}">${e(task.title)}</option>`).join('')}</select></label>` : ''}
        <label class="full">Notes (optional)<textarea name="note" rows="3" maxlength="600"></textarea></label>`, 'Start timer'));
    },
  };

  return {
    page, actions, load, scope, reviewTable, rememberFilters,
    clockDetails(shift, latest) {
      const active = state().workPeriods.find((period) => period.end_at == null);
      const hasShift = shift || latest?.resume_pending;
      if (!hasShift && !active) return '';
      const start = (label, kind) => `<button type="button" class="btn secondary" data-action="period-start" data-value="${kind}">${label}</button>`;
      return `<div class="hr-clock-buttons worksheet-clock-actions">
        ${hasShift ? actionButton('End shift', 'end-shift', 'log-out', 'secondary', latest.id) : ''}
        ${active ? actionButton('End ' + labels[active.kind].toLowerCase(), 'period-end', 'clock-3', 'primary', active.id) :
          (shift ? start('Start lunch', 'lunch') + start('Personal break', 'personal') : '') + start('Shoot travel', 'travel')}
      </div>${active ? `<p class="hr-muted">${labels[active.kind]} started at ${time(active.start_at)} IST.</p>` : ''}`;
    },
    reset() { report = undefined; filters = undefined; draft = undefined; version++; },
  };
}
