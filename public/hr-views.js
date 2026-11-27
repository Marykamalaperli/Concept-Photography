import { dailyHours } from './work-hours.js';
import { assignedTo } from './attendance-policy.js';
import { dayStart, dayLength, dateRange, weekday, isDayOff, leaveDays, leaveLedger, timeForDay } from './hr-policy.js';

const monthFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', month: 'short' });
const dailyFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
const leaveLabels = { casual: 'Casual leave', half: 'Half-day leave', unpaid: 'Unpaid leave' };
const lanes = [['todo', 'To do'], ['progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const getMonth = (period, offset = 0) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
};
const monthTitle = (period) => monthFormat.format(dayStart(period + '-01'));
const monthEnd = (period, date) => date(dayStart(getMonth(period, 1) + '-01') - dayLength);
const dayLabel = (date) => dailyFormat.format(dayStart(date));
const elapsedClock = (ms) => {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
};
const bookingState = (shoot) => shoot.completed_at ? 'done' : shoot.shoot_status || 'booked';
const bookingLabels = { booked: 'Booked', postponed: 'Postponed', done: 'Done', cancelled: 'Cancelled' };
const bookingColors = { booked: 'lavender', postponed: 'sand', done: 'sage', cancelled: 'neutral' };

export function createHrViews(ui) {
  const { actor, state, manager, e, icon, tag, heading, viewLink, empty, actionButton, time, timeInput, day, today,
    money, duration, employee, table, clockCard, attendanceTable, sessionsFor, activeSession, entryForm, openDialog, applyAction, render,
    shootEndLabel } = ui;
  let attendanceMonth = '';
  let attendancePerson = '';
  let shootMonth = '';
  let shootFilter = 'all';
  let taskFilter = 'all';

  const panel = (title, body, actions = '', className = '') => `<section class="panel hr-panel ${className}">
    <header class="hr-panel-head"><h2>${title}</h2>${actions}</header><div class="hr-panel-body">${body}</div></section>`;
  const button = (label, action, symbol, id) => actionButton(label, action, symbol, 'secondary', id);
  const field = (label, content, full = false) => `<label${full ? ' class="full"' : ''}>${label}${content}</label>`;
  const options = (items, selected) => items.map(([key, label]) =>
    `<option value="${e(key)}" ${String(selected) === String(key) ? 'selected' : ''}>${e(label)}</option>`).join('');
  const employees = () => state().employees.map((person) => [person.id, person.name]);
  const personal = (records, person = actor().id) => records.filter((record) => record.employee_id === person);
  const calendarTag = (shoot) => tag(bookingLabels[bookingState(shoot)], bookingColors[bookingState(shoot)]);
  const dateTile = (date) => `<span class="hr-date-tile"><strong>${Number(date.slice(8))}</strong><small>${monthShort.format(dayStart(date))}</small></span>`;
  const hrRequests = (kind, person = actor().id) => personal(state().hrRequests, person).filter((request) => request.kind === kind);
  const announcementRows = (items, edit = false) => items.length ? items.map((item) => `<article class="hr-entry">
    <div><h3>${e(item.title)}</h3><span class="hr-muted">${dayLabel(day(item.published_at))}</span><p class="hr-message">${e(item.message)}</p></div>
    ${edit ? button('Edit', 'announcement-edit', 'pencil', item.id) : ''}</article>`).join('') : empty('No announcements yet.');

  function monthPicker(period, action, latest = false) {
    return `<div class="hr-month"><button class="icon-button" type="button" data-action="${action}" data-value="-1" aria-label="Previous month">${icon('chevron-left')}</button>
      <strong>${monthTitle(period)}</strong>
      <button class="icon-button" type="button" data-action="${action}" data-value="1" aria-label="Next month" ${latest ? 'disabled' : ''}>${icon('chevron-right')}</button></div>`;
  }

  function dailyReport(person, dates, now) {
    const records = personal(state().attendance, person.id);
    const requests = hrRequests('time', person.id);
    const { days } = leaveLedger(state().hrRequests, person, state().hrSettings, state().holidays);
    return dates.map((date) => {
      const correction = requests.find((request) => request.day_from === date && request.status === 'approved');
      const pending = requests.find((request) => request.day_from === date && request.status === 'pending');
      const times = timeForDay(records, date, now, correction);
      const off = isDayOff(date, state().hrSettings, state().holidays);
      const leave = days.get(date);
      const employed = person.employment_start && date >= person.employment_start;
      const present = times.in != null || times.out != null;
      const missing = !present && !off && employed && date < day(now) ? 1 - (leave?.units ?? 0) : 0;
      const officeStart = state().hrSettings.work_start;
      const late = times.in != null && times.in > Date.parse(`${date}T${officeStart}:00+05:30`) &&
        !off && records.some((record) => day(record.clock_in) === date && record.site && !JSON.parse(record.site).taskId);
      const status = present ? late ? tag('Late', 'sand') : tag('Present', 'sage') :
        leave ? tag('On leave', leave.unpaid ? 'sand' : 'sage') :
          off ? tag(state().holidays.some((holiday) => holiday.day === date) ? 'Holiday' : 'Week off', 'neutral') :
            date === day(now) ? tag('Not in yet', 'neutral') : missing ? tag('Check-in missing', 'sand') : tag('No record', 'neutral');
      const work = new Set(personal(state().sessions, person.id)
        .filter((entry) => entry.start_at < dayStart(date) + dayLength && (entry.end_at ?? now) > dayStart(date))
        .map((entry) => entry.task_id));
      const logs = personal(state().workLogs, person.id).filter((entry) => entry.day === date).length;
      return { date, times, correction, pending, status, off, leave, present, missing, work: work.size + logs };
    });
  }

  const timeRequestButton = (date, label = 'Request change') =>
    `<button type="button" class="hr-text-button" data-action="time-request" data-value="${e(date)}">${label}</button>`;

  function attendanceSummary() {
    const current = today().slice(0, 7);
    const period = attendanceMonth || current;
    const start = period + '-01';
    const end = period === current ? today() : monthEnd(period, day);
    const days = dailyReport(actor(), dateRange(start, end), Date.now()).filter(({ date }) =>
      !actor().employment_start || date >= actor().employment_start);
    const figures = [
      ['Days elapsed', days.length, 'neutral'],
      ['Present', days.filter((item) => item.present).length, 'sage'],
      ['Check-in missing', days.reduce((total, item) => total + item.missing, 0), 'sand'],
      ['Unpaid leave', days.reduce((total, item) => total + (item.leave?.unpaid ?? 0), 0), 'peach'],
      ['Week-offs & holidays', days.filter((item) => item.off).length, 'neutral'],
      ['Leave taken', days.reduce((total, item) => total + (item.leave?.units ?? 0), 0), 'sand'],
    ];
    return panel('Attendance', `${monthPicker(period, 'attendance-month', period === current)}
      <dl class="hr-figures">${figures.map(([label, total, color]) => `<div><dt>${label}</dt><dd class="${color}">${total}</dd></div>`).join('')}</dl>`, viewLink('attendance', 'Details'));
  }

  function attendance() {
    const now = Date.now();
    const person = employee(Number(attendancePerson)) ?? actor();
    const end = attendanceMonth && attendanceMonth !== today().slice(0, 7) ? monthEnd(attendanceMonth, day) : today();
    const start = attendanceMonth ? attendanceMonth + '-01' : day(dayStart(end) - 13 * dayLength);
    const data = dailyReport(person, dateRange(start, end), now).reverse();
    const rows = data.map(({ date, times, correction, pending, status, work, off, present }) => [
      `<strong>${dayLabel(date)}</strong>`, times.in == null ? '—' : time(times.in), times.out == null ? '—' : time(times.out),
      times.total > 0 ? duration(times.total) : '—', `<div class="hr-inline">${status}${correction ? tag('Edited', 'lavender') : ''}</div>`, work,
      pending ? tag('Change pending', 'sand') : person.id === actor().id && (!off || present) && (!person.employment_start || date >= person.employment_start)
        ? timeRequestButton(date) : '—',
    ]);
    const requests = hrRequests('time', person.id);
    const controls = `<div class="hr-toolbar">${monthPicker(attendanceMonth || today().slice(0, 7), 'attendance-month', !attendanceMonth || attendanceMonth === today().slice(0, 7))}
      ${attendanceMonth ? button('Last 14 days', 'attendance-recent', 'calendar-days') : ''}
      ${manager() ? field('Employee', `<select id="hr-attendance-person">${options(employees(), person.id)}</select>`) : ''}</div>`;
    return `${heading('Attendance', 'Daily hours, time-change requests, and verified location records.')}
      <div class="hr-attendance-layout">${person.id === actor().id ? clockCard() : ''}${panel(attendanceMonth ? monthTitle(attendanceMonth) : 'Last 14 days',
        controls + table('Daily attendance', ['Date', 'In', 'Out', 'Hours', 'Status', 'Tasks', 'Time change'], rows))}</div>
      ${panel(person.id === actor().id ? 'My time-change requests' : 'Time-change requests', requestRows(requests), '', 'hr-section')}
      ${panel('Verified clock records', attendanceTable(personal(state().attendance, person.id), true), '', 'hr-section')}`;
  }

  function requestRows(entries, review = false) {
    const settings = state().hrSettings;
    return entries.length ? entries.map((request) => {
      const isLeave = request.kind === 'leave';
      const person = employee(request.employee_id);
      const date = dayLabel(request.day_from) + (request.day_from === request.day_to ? '' : ' – ' + dayLabel(request.day_to));
      const count = leaveDays(request, settings, state().holidays).length;
      const detail = isLeave ? date : [
        request.clock_in != null ? 'In ' + time(request.clock_in) : '', request.clock_out != null ? 'Out ' + time(request.clock_out) : '',
      ].filter(Boolean).join(' · ');
      const title = isLeave ? `${leaveLabels[request.leave_type]} · ${request.leave_type === 'half' ? '½ day' : count + (count === 1 ? ' day' : ' days')}` : date;
      const colors = { pending: 'sand', approved: 'sage', declined: 'peach', cancelled: 'neutral' };
      const status = request.status[0].toUpperCase() + request.status.slice(1);
      return `<article class="hr-entry"><div><h3>${title}${review ? ` · ${e(person?.name)}` : ''}</h3><p class="hr-muted">${detail}</p><p class="hr-message">${e(request.reason)}</p></div>
        <div class="hr-inline">${tag(status, colors[request.status])}
          ${request.status === 'pending' ? review ? `${button('Approve', 'hr-approve', 'check', request.id)}${button('Decline', 'hr-decline', 'x', request.id)}` :
            request.employee_id === actor().id ? button('Cancel', 'hr-cancel', 'x', request.id) : '' : ''}
        </div></article>`;
    }).join('') : empty('No requests yet.');
  }

  function balance() {
    return leaveLedger(state().hrRequests, actor(), state().hrSettings, state().holidays).balance(today());
  }

  function leaveBalance() {
    const { available, used, earned } = balance();
    return `<div class="hr-balance"><span class="hr-large">${available}</span><strong>casual days left</strong>
      <p class="hr-muted">${used} used of ${earned} earned · +${state().hrSettings.monthly_leave} each month</p>
      <progress aria-label="Casual leave used" max="${earned || 1}" value="${used}"></progress></div>`;
  }

  function holidaysList(items, edit = false) {
    return items.length ? items.map((holiday) => `<article class="hr-entry hr-holiday">${dateTile(holiday.day)}
      <div><h3>${e(holiday.name)}</h3><p class="hr-muted">${dayLabel(holiday.day)} ${holiday.day.slice(0, 4)}</p></div>
      ${edit ? `<button type="button" class="hr-text-button" data-action="holiday-edit" data-value="${e(holiday.day)}">Edit</button>` : ''}</article>`).join('') : empty('No holidays on this list.');
  }

  function leave() {
    const year = today().slice(0, 4);
    return `${heading('Leave & holidays', 'See your allowance and submit requests for review.', actionButton('Apply for leave', 'leave-request', 'calendar-plus'))}
      <div class="hr-two">
        ${panel('Leave balance · ' + year, leaveBalance())}
        ${panel('Company holidays', holidaysList(state().holidays.filter((holiday) => manager() || holiday.day >= year + '-01-01')),
          manager() ? button('Add holiday', 'holiday-edit', 'plus') : '')}
      </div>
      ${panel('My leave requests', requestRows(hrRequests('leave')), '', 'hr-section')}`;
  }

  function shootRows(items) {
    return items.length ? items.map((shoot) => `<article class="hr-entry hr-shoot-row">
      ${bookingState(shoot) === 'postponed' ? `<span class="hr-date-tile">${icon('calendar-clock')}</span>` : dateTile(day(shoot.start_at))}
      <div><button type="button" class="hr-title-button" data-action="details" data-id="${shoot.id}">${e(shoot.title)}</button>
      <p class="hr-muted">${bookingState(shoot) === 'postponed' ? e(shoot.location) :
        `${time(shoot.start_at)} – ${shootEndLabel(shoot)} · ${e(shoot.location)}`}${shoot.crew?.length ? ' · ' + e(shoot.crew.map((member) => member.employee_id === actor().id ? 'You' : member.name).join(', ')) : ''}</p></div>
      ${calendarTag(shoot)}</article>`).join('') : empty('No shoots to show.');
  }

  function shootCalendar() {
    const period = shootMonth || today().slice(0, 7);
    const start = period + '-01';
    const dates = dateRange(start, monthEnd(period, day));
    const visible = state().tasks.filter((task) => task.category === 'Photo shoot' &&
      (shootFilter === 'all' || (shootFilter === 'mine' ? assignedTo(task, actor().id) : bookingState(task) === shootFilter)))
      .sort((a, b) => a.start_at - b.start_at);
    const agenda = visible.filter((shoot) => bookingState(shoot) !== 'postponed' && day(shoot.start_at).startsWith(period));
    const postponed = visible.filter((shoot) => bookingState(shoot) === 'postponed');
    const trailing = (7 - (dates.length + weekday(start)) % 7) % 7;
    const days = dates.map((date) => {
      const holiday = state().holidays.find((item) => item.day === date);
      const shoots = agenda.filter((shoot) => day(shoot.start_at) === date);
      return `<div class="hr-calendar-day ${date === today() ? 'today' : ''}">
        <span class="hr-calendar-number" aria-label="${dayLabel(date)}">${Number(date.slice(8))}</span>
        ${holiday ? `<span class="hr-calendar-holiday">${e(holiday.name)}</span>` : ''}
        ${shoots.map((shoot) => `<button type="button" class="hr-calendar-event ${bookingState(shoot)}" data-action="details" data-id="${shoot.id}" title="${e(shoot.title)}">
          <time>${time(shoot.start_at)}</time><span>${e(shoot.title)}</span><span class="sr-only">, ${bookingLabels[bookingState(shoot)]}</span></button>`).join('')}
      </div>`;
    });
    const controls = `<div class="hr-toolbar calendar-toolbar">${monthPicker(period, 'shoot-month')}
      <div class="hr-inline">${button('Today', 'shoot-today', 'calendar-days')}
      ${field('Show', `<select id="hr-shoot-filter">${options([['all', manager() ? 'All shoots' : 'My shoots'],
        ...(manager() ? [['mine', 'Assigned to me']] : []), ...Object.entries(bookingLabels)], shootFilter)}</select>`)}</div></div>`;
    return `${heading('Shoot calendar', 'Browse bookings and scheduled holidays in IST.',
      manager() ? actionButton('Book shoot', 'new-shoot', 'plus') : viewLink('schedule', 'My schedule'))}
      ${controls}<section class="hr-calendar" aria-label="Shoot calendar for ${monthTitle(period)}">
        ${weekdays.map((name) => `<strong class="hr-calendar-weekday">${name.slice(0, 3)}</strong>`).join('')}
        ${'<div class="hr-calendar-blank" aria-hidden="true"></div>'.repeat(weekday(start))}
        ${days.join('')}${'<div class="hr-calendar-blank" aria-hidden="true"></div>'.repeat(trailing)}
      </section>
      <div class="hr-calendar-legend">${Object.keys(bookingLabels).map((key) => tag(bookingLabels[key], bookingColors[key])).join('')}</div>
      <div class="hr-two hr-agenda">
        ${panel(`${monthTitle(period)} · ${agenda.length} ${agenda.length === 1 ? 'shoot' : 'shoots'}`, shootRows(agenda))}
        ${panel('Postponed shoots', postponed.length ? shootRows(postponed) : empty('No shoots are waiting for a new date.'))}
      </div>`;
  }

  function taskStage(task) {
    if (task.completed_at) return 'done';
    if (task.blocked_reason || task.work_state === 'reschedule') return 'blocked';
    if (task.work_state === 'review' || sessionsFor(task).length) return 'progress';
    return 'todo';
  }

  function boardTasks() {
    return state().tasks.filter((task) => task.category !== 'Photo shoot' && !task.is_open &&
      (taskFilter === 'all' || task.employee_id === Number(taskFilter)));
  }

  function taskBoard() {
    const now = Date.now();
    const tasks = boardTasks().filter((task) => !task.completed_at || now - task.completed_at < 14 * dayLength);
    const open = tasks.filter((task) => !task.completed_at);
    const overdue = open.filter((task) => !task.is_unscheduled && task.work_state === 'ready' && task.start_at + task.estimate * 60_000 < now).length;
    const next = !manager() && open.filter((task) => task.work_state === 'ready' && !task.blocked_reason && !activeSession(task))
      .sort((a, b) => (b.priority - a.priority) || (a.is_unscheduled - b.is_unscheduled) || (a.start_at - b.start_at))[0];
    const actions = actionButton(manager() ? 'Assign task' : 'Add task', 'new-board-task', 'plus');
    return `${heading('Tasks', 'Manage your work from assignment to completion.', actions)}
      <div class="hr-toolbar">${manager() ? field('Show', `<select id="hr-task-filter">${options([['all', 'All employees'], ...employees()], taskFilter)}</select>`)
        : '<span>Assigned to me</span>'}<span class="hr-muted">${open.length} open · ${overdue} overdue</span></div>
      ${next ? `<section class="panel next-work"><div><h2>Next available task</h2>
        <p>${e(next.title)} · ${next.is_unscheduled ? 'Unscheduled' : dayLabel(day(next.start_at))}</p></div>
        ${actionButton('Open task', 'details', 'arrow-right', 'secondary', next.id)}</section>` : ''}
      <div class="hr-board">${lanes.map(([key, title]) => {
        const items = tasks.filter((task) => taskStage(task) === key);
        return `<section class="hr-lane ${key}"><header><h2>${title}</h2><span>${items.length}</span></header>
          ${items.length ? items.map((task) => `<article class="hr-task">
            <button type="button" class="hr-title-button" data-action="details" data-id="${task.id}">${e(task.title)}</button>
            <p>${e(task.category)} · ${task.is_unscheduled ? 'Unscheduled' : dayLabel(day(task.start_at))}</p>${manager() ? `<p>${e(employee(task.employee_id)?.name)}</p>` : ''}
            ${task.priority ? tag('Priority', 'peach') : ''}${task.blocked_reason ? `<p class="hr-message">${e(task.blocked_reason)}</p>` : ''}
            ${task.work_state === 'reschedule' ? tag('Needs rescheduling', 'sand') : ''}${task.work_state === 'review' ? tag('In review', 'lavender') : ''}
            ${activeSession(task) ? tag('Timer running', 'sage') : ''}
          </article>`).join('') : empty(key === 'done' ? 'Tasks finished in the past two weeks appear here.' : 'Nothing here yet.')}</section>`;
      }).join('')}</div>`;
  }

  function trackedWork(person, date, now) {
    return state().tasks.filter((task) => assignedTo(task, person)).flatMap((task) => {
      const start = dayStart(date);
      const end = start + dayLength;
      const entries = sessionsFor(task).filter((entry) => entry.employee_id === person && entry.start_at < end && (entry.end_at ?? now) >= start);
      if (!entries.length) return [];
      const total = entries.reduce((sum, entry) => sum + Math.max(0, Math.min(entry.end_at ?? now, end) - Math.max(start, entry.start_at)), 0);
      return [{ task, total }];
    });
  }

  function workRows(person, date, limit = Infinity) {
    const notes = personal(state().workLogs, person).filter((entry) => entry.day === date);
    const tracked = trackedWork(person, date, Date.now());
    const entries = [
      ...tracked.map(({ task, total }) => `<article class="hr-entry"><div>
        <button type="button" class="hr-title-button" data-action="details" data-id="${task.id}">${e(task.title)}</button><p class="hr-muted">Timer</p>
        </div><strong>${duration(total)}</strong></article>`),
      ...notes.map((entry) => `<article class="hr-entry"><div><h3 class="hr-message">${e(entry.note)}</h3><p class="hr-muted">Work log</p></div>
        ${entry.minutes ? `<strong>${duration(entry.minutes * 60_000)}</strong>` : ''}</article>`),
    ];
    return entries.slice(0, limit).join('') || empty('No work logged.');
  }

  function workLog() {
    const now = Date.now();
    const dates = new Set([today(), ...state().workLogs.map((entry) => entry.day)]);
    for (const entry of state().sessions) {
      for (const date of dateRange(day(entry.start_at), day(entry.end_at ?? now))) dates.add(date);
    }
    const employeeIds = manager() ? state().employees.map(({ id }) => id) : [actor().id];
    return `${heading('Work log', manager() ? 'Review the team’s tracked tasks and manual work entries.' : 'Review tracked tasks and add notes for other work.',
      actionButton('Log work', 'work-log', 'plus'))}
      <div class="stack">${[...dates].sort().reverse().flatMap((date) => employeeIds.filter((id) => (id === actor().id && date === today()) ||
        personal(state().workLogs, id).some((entry) => entry.day === date) || trackedWork(id, date, Date.now()).length).map((id) =>
        panel(`${date === today() ? 'Today' : dayLabel(date)}${manager() ? ' · ' + e(employee(id)?.name) : ''}`, workRows(id, date)))).join('')}</div>`;
  }

  function payslipRows(items, admin = false) {
    return items.length ? table('Payslips', [...(admin ? ['Employee'] : []), 'Pay period', 'Gross pay', 'Deductions', 'Net pay', 'Notes', ...(admin ? [''] : [])],
      items.map((item) => [...(admin ? [e(employee(item.employee_id)?.name)] : []), monthTitle(item.period),
        money(item.gross_paise), money(item.deductions_paise), `<strong>${money(item.gross_paise - item.deductions_paise)}</strong>`, e(item.note || '—'),
        ...(admin ? [button('Edit', 'payslip-edit', 'pencil', item.id)] : [])])) : empty('No payslips have been published.');
  }

  function payroll() {
    return `${heading('Payslips', manager() ? 'Publish monthly payslips and review payroll records.' : 'View your published monthly payslips.',
      manager() ? actionButton('Publish payslip', 'payslip-edit', 'plus') : '')}${panel(manager() ? 'Published payslips' : 'My payslips', payslipRows(state().payslips, manager()))}`;
  }

  function announcements() {
    return `${heading('Announcements', 'Updates from Concept Photography.',
      manager() ? actionButton('Post announcement', 'announcement-edit', 'plus') : '')}
      ${panel('Company announcements', announcementRows(state().announcements, manager()))}`;
  }

  function approvals() {
    const entries = [...state().hrRequests].sort((first, second) =>
      Number(second.status === 'pending') - Number(first.status === 'pending') || second.requested_at - first.requested_at);
    return `<div class="hr-two hr-section">${panel('Leave requests', requestRows(entries.filter((request) => request.kind === 'leave'), true))}
      ${panel('Time-change requests', requestRows(entries.filter((request) => request.kind === 'time'), true))}</div>`;
  }

  function paySummary(items) {
    const latest = items[0];
    if (!latest) return empty('Net pay appears after your first payslip.');
    const trend = items.slice(0, 6).reverse();
    const peak = Math.max(1, ...trend.map((item) => item.gross_paise - item.deductions_paise));
    return `<div class="hr-balance"><span class="hr-muted">${monthTitle(latest.period)} net pay</span>
      <strong class="hr-large">${money(latest.gross_paise - latest.deductions_paise)}</strong>
      ${trend.length > 1 ? `<ul class="hr-pay-trend" aria-label="Recent monthly net pay">${trend.map((item) => {
        const net = item.gross_paise - item.deductions_paise;
        return `<li aria-label="${monthTitle(item.period)}: ${money(net)}" title="${monthTitle(item.period)} · ${money(net)}">
          <span aria-hidden="true" style="height:${Math.max(4, net / peak * 100)}%"></span></li>`;
      }).join('')}</ul>` : ''}</div>`;
  }

  function todayActions(tasks, now) {
    const data = state();
    const date = today();
    const active = data.sessions.find((session) => session.end_at === null);
    const activeWork = active && data.tasks.find((task) => task.id === active.task_id);
    const next = tasks.find((task) => task.id !== activeWork?.id && task.work_state === 'ready' &&
      !task.is_unscheduled && task.start_at + task.estimate * 60_000 > now);
    const approved = data.plans.find((plan) => plan.work_day === date && plan.status === 'approved');
    const planned = approved ? data.tasks.filter((task) => task.daily_plan_id === approved.id).length : 0;
    const unscheduled = tasks.filter((task) => task.is_unscheduled).length;
    const requests = data.hrRequests.filter((entry) => entry.status === 'pending').length +
      data.taskChanges.filter((entry) => entry.status === 'pending').length +
      data.requests.filter((entry) => entry.status === 'pending').length +
      data.plans.filter((entry) => entry.status === 'submitted').length +
      data.shiftReviews.filter((entry) => entry.status === 'pending').length +
      data.tasks.filter((task) => task.work_state === 'review').length;
    const nextPlan = data.plans.filter((plan) => plan.work_day > date && !['superseded', 'rejected'].includes(plan.status))
      .sort((first, second) => first.work_day.localeCompare(second.work_day) || second.revision - first.revision)[0];
    const describe = (task, fallback) => task ?
      `<button class="hr-title-button" type="button" data-action="details" data-id="${task.id}">${e(task.title)}</button>` : fallback;
    return `<dl class="balance-list dashboard-queues">
      <div><dt>Active task</dt><dd>${describe(activeWork, 'No timer running')}</dd></div>
      <div><dt>Next scheduled task</dt><dd>${describe(next, 'No upcoming work')}</dd></div>
      <div><dt>Approved plan today</dt><dd>${approved ? planned + (planned === 1 ? ' task' : ' tasks') : 'No approved plan'}</dd></div>
      <div><dt>Unscheduled assignments</dt><dd>${unscheduled}</dd></div>
      <div><dt>Items awaiting approval</dt><dd>${requests}</dd></div>
      <div><dt>Next-day plan</dt><dd>${nextPlan ? dayLabel(nextPlan.work_day) + ' · ' + e(nextPlan.status) :
        'Submit by ' + e(data.hrSettings.plan_deadline ?? '17:30') + ' IST'}</dd></div>
    </dl>`;
  }

  function recordsSummary() {
    const data = state();
    const footage = data.footageChecks.filter((item) => ['assigned', 'returned', 'incident'].includes(item.status));
    const unread = data.operationNotices.filter((notice) => notice.read_at === null).length;
    return `<dl class="balance-list dashboard-queues">
      <div><dt>${viewLink('worksheet', 'Worksheet and work performance')}</dt><dd>${elapsedClock(hoursToday().actual)} today</dd></div>
      <div><dt>${viewLink('revenue', 'Revenue contribution this month')}</dt><dd>${money(data.revenueSummary?.total ?? 0)}</dd></div>
      ${footage.length ? `<div><dt>${viewLink('footage', 'Footage to verify')}</dt><dd>${footage.length}</dd></div>` : ''}
      <div><dt>${viewLink('notifications', 'Notifications')}</dt><dd>${unread} unread updates</dd></div>
    </dl>`;
  }

  function dashboard() {
    const now = Date.now();
    const upcoming = state().tasks.filter((task) => task.category === 'Photo shoot' && bookingState(task) === 'booked' &&
      task.start_at + task.estimate * 60_000 > now).sort((a, b) => a.start_at - b.start_at);
    const availableHolidays = state().holidays.filter((holiday) => holiday.day >= today()).slice(0, 3);
    const tasks = boardTasks().filter((task) => !task.completed_at);
    const payslips = personal(state().payslips);
    return `${heading('My Dashboard', e(actor().name) + ' · ' + e(actor().role))}
      <div class="hr-dashboard">
        ${clockCard()}
        ${panel('Holidays', availableHolidays.length ? holidaysList(availableHolidays) : empty('No upcoming holidays.'), viewLink('leave', 'Holiday list'))}
        ${panel('Leave', leaveBalance(), button('Apply', 'leave-request', 'calendar-plus'))}
        ${attendanceSummary()}
      ${panel('Work priorities', todayActions(tasks, now), viewLink('daily-plans', 'Daily plans'), 'hr-span')}
      ${panel('My records', recordsSummary(), button('Private notepad', 'profile', 'clipboard-list'), 'hr-span')}
        ${panel('Upcoming shoots', shootRows(upcoming.slice(0, 4)), viewLink('shoot-calendar', 'Calendar'), 'hr-span')}
        ${panel('My tasks', tasks.length ? tasks.slice(0, 4).map((task) => `<article class="hr-entry">
          <div><button type="button" class="hr-title-button" data-action="details" data-id="${task.id}">${e(task.title)}</button>
            <p class="hr-muted">${dayLabel(day(task.start_at))} · ${time(task.start_at)}</p></div>${task.priority ? tag('Priority', 'peach') : ''}</article>`).join('') :
          empty('No open tasks.'), viewLink('task-board', 'All tasks'), 'hr-span')}
        ${panel('Today’s work', workRows(actor().id, today(), 4), viewLink('work-log', 'Open log'), 'hr-span')}
        ${panel('Payroll', paySummary(payslips), viewLink('payroll', 'Payslips'), 'hr-span')}
        ${panel('Announcements', announcementRows(state().announcements.slice(0, 2)), viewLink('announcements', 'All updates'), 'hr-full')}
      </div>`;
  }

  function requestForm(kind, date) {
    const isLeave = kind === 'leave';
    const times = !isLeave && dailyReport(actor(), [date], Date.now())[0].times;
    openDialog(isLeave ? 'Apply for leave' : 'Request a time change',
      isLeave ? 'Half-day leave uses half a casual day. Leave beyond your earned balance is counted as unpaid.' :
        'Approved changes appear in your daily attendance report.', entryForm('hr/requests', `
        <input type="hidden" name="kind" value="${kind}">
        ${field(isLeave ? 'From' : 'Date', `<input type="date" name="from" value="${date}" required ${isLeave ? '' : `max="${today()}"`}>`, !isLeave)}
        ${isLeave ? field('To', `<input type="date" name="to" value="${date}" required>`) +
          field('Leave type', `<select name="leaveType">${options(Object.entries(leaveLabels), 'casual')}</select>`, true) :
          field('Check-in time (IST)', `<input type="time" name="clockIn" value="${times.in == null ? '' : timeInput.format(times.in)}">`) +
          field('Check-out time (IST)', `<input type="time" name="clockOut" value="${times.out == null ? '' : timeInput.format(times.out)}">`)}
        ${field('Reason', '<textarea name="reason" rows="3" required maxlength="800"></textarea>', true)}`, 'Send request'));
  }

  function settingsForm() {
    const values = state().hrSettings;
    const number = (label, name, value, min, max) => field(label,
      `<input name="${name}" type="number" min="${min}" max="${max}" required value="${value}">`);
    const optionalDays = (label, name, value, min, placeholder) => field(label,
      `<input name="${name}" type="number" min="${min}" max="3650" value="${e(value)}" placeholder="${placeholder}">`);
    const clock = (label, name, value, required = false) => field(label,
      `<input name="${name}" type="time" ${required ? 'required' : ''} value="${e(value)}">`);
    const switchField = (label, name, value) => field(label, `<select name="${name}">
      <option value="true"${value ? ' selected' : ''}>Enabled</option>
      <option value="false"${!value ? ' selected' : ''}>Disabled</option></select>`);
    const group = (title, fields) => `<fieldset class="full form-grid settings-fields"><legend>${title}</legend>${fields}</fieldset>`;
    const tomorrow = day(dayStart(today()) + dayLength);
    openDialog('Business policy', 'Work rules apply from the selected date. GPS, new-task evidence, and retention settings apply when saved.',
      entryForm('hr/settings', `
        ${field('Work policy effective from (IST)', `<input name="effectiveFrom" type="date" value="${tomorrow}" min="${today()}" required>`, true)}
        ${group('Working hours and leave',
          clock('Office opens (IST)', 'workStart', values.work_start) + clock('Office closes (IST)', 'workEnd', values.work_end) +
          field('Weekly day off', `<select name="weekOff">${options(weekdays.map((label, index) => [index, label]), values.week_off)}</select>`) +
          number('Casual leave days per month', 'monthlyLeave', values.monthly_leave, 0, 31) +
          number('Required minutes per day', 'requiredMinutes', values.required_minutes, 0, 1440) +
          number('Minutes before overtime counts', 'overtimeGrace', values.overtime_grace_minutes, 0, 120))}
        ${group('Breaks and travel',
          clock('Lunch starts (IST)', 'lunchStart', values.lunch_start) +
          number('Lunch target, minutes', 'lunchMinutes', values.lunch_minutes, 5, 180) +
          number('Personal break warning, minutes', 'personalBreakMinutes', values.personal_break_minutes, 5, 180) +
          switchField('Count personal breaks during a shift', 'personalBreakPaid', values.personal_break_paid) +
          switchField('Count official travel outside shifts', 'travelPaid', values.travel_paid))}
        ${group('GPS verification',
          number('Office radius, metres', 'officeRadius', values.office_radius_m, 50, 100) +
          number('Shoot radius, metres', 'shootRadius', values.shoot_radius_m, 50, 100) +
          number('Maximum GPS accuracy, metres', 'maxAccuracy', values.max_accuracy_m, 5, 100) +
          number('Interruption grace, minutes', 'verificationGraceMinutes', values.verification_grace_minutes, 2, 60) +
          number('Boundary confirmations', 'boundarySamples', values.boundary_samples, 2, 4) +
          number('Between confirmations, milliseconds', 'boundaryDelay', values.boundary_delay_ms, 1000, 5000))}
        ${group('Scheduling and review',
          clock('Daily plan deadline (IST)', 'planDeadline', values.plan_deadline, true) +
          number('Task reminder before finish, minutes', 'reminderMinutes', values.task_reminder_minutes, 0, 120) +
          switchField('Require attachments for new tasks', 'attachmentRequired', values.attachment_required))}
        ${group('Data retention in days',
          optionalDays('Removed attachments', 'removedFileDays', values.removed_file_days, 7, 'Server default') +
          optionalDays('Local backups', 'backupDays', values.backup_days, 1, 'Server default') +
          optionalDays('Precise GPS fixes from closed shifts', 'attendanceFixDays', values.attendance_fix_days, 30, 'Keep indefinitely') +
          optionalDays('Detailed business audit metadata', 'auditDetailDays', values.audit_detail_days, 30, 'Keep indefinitely') +
          '<p class="full hr-muted">Shift totals, verified sites and audit event summaries are retained. Older backups follow their own cleanup schedule.</p>')}
        ${field('Reason for change', '<input name="reason" maxlength="350">', true)}`, 'Save policy'));
  }

  function holidayForm(date) {
    const existing = state().holidays.find((holiday) => holiday.day === date);
    openDialog(existing ? 'Edit holiday' : 'Add holiday', '', entryForm('hr/holidays', `
      ${field('Date', `<input type="date" name="day" value="${existing?.day ?? today()}" required ${existing ? 'readonly' : ''}>`)}
      ${field('Holiday name', `<input name="name" required maxlength="100" value="${e(existing?.name)}">`)}
      ${existing ? `<div class="full">${button('Remove holiday', 'holiday-remove', 'trash-2')}</div>` : ''}`, 'Save holiday'));
  }

  function payslipForm(id) {
    const item = state().payslips.find((record) => record.id === id);
    openDialog(item ? 'Edit payslip' : 'Publish payslip', 'Payslips are visible to the selected employee when saved.',
      entryForm('hr/payslips', `
      ${field('Employee', `<select name="employeeId" required ${item ? 'disabled' : ''}>${options(employees(), item?.employee_id)}</select>`)}
      ${field('Pay period', `<input type="month" name="period" value="${item?.period ?? today().slice(0, 7)}" max="${today().slice(0, 7)}" required ${item ? 'readonly' : ''}>`)}
      ${item ? `<input type="hidden" name="employeeId" value="${item.employee_id}">` : ''}
      ${field('Gross pay (₹)', `<input name="gross" type="number" min="0" max="999999999.99" step="0.01" value="${item ? item.gross_paise / 100 : ''}" required>`)}
      ${field('Deductions (₹)', `<input name="deductions" type="number" min="0" max="999999999.99" step="0.01" value="${item ? item.deductions_paise / 100 : 0}" required>`)}
      ${field('Notes', `<textarea name="note" maxlength="800" rows="3">${e(item?.note)}</textarea>`, true)}`, item ? 'Save payslip' : 'Publish payslip'));
  }

  function announcementForm(id) {
    const item = state().announcements.find((record) => record.id === id);
    openDialog(item ? 'Edit announcement' : 'Post announcement', 'Everyone in the workspace can see announcements.',
      entryForm('hr/announcements', `
      ${item ? `<input type="hidden" name="id" value="${id}">` : ''}
      ${field('Title', `<input name="title" maxlength="100" required value="${e(item?.title)}">`, true)}
      ${field('Message', `<textarea name="message" rows="4" maxlength="1600" required>${e(item?.message)}</textarea>`, true)}
      ${item ? `<div class="full">${button('Remove announcement', 'announcement-remove', 'trash-2', id)}</div>` : ''}`, 'Save announcement'));
  }

  function logForm() {
    openDialog('Log work', 'Use this for work outside the task timer.', entryForm('hr/work-logs', `
      ${field('Date', `<input type="date" name="day" max="${today()}" value="${today()}" required>`)}
      ${field('Minutes', '<input name="minutes" type="number" min="0" max="1440" value="0" required>')}
      ${field('Work summary', '<textarea name="note" maxlength="600" rows="4" required></textarea>', true)}`, 'Save log'));
  }

  function blockForm(task) {
    openDialog('Block task', e(task.title), entryForm('task-action', `
      <input type="hidden" name="taskId" value="${task.id}"><input type="hidden" name="action" value="block">
      ${field('What’s blocking this task?', `<textarea name="reason" maxlength="400" rows="3" required>${e(task.blocked_reason)}</textarea>`, true)}`, 'Block task'));
  }

  const actions = {
    'attendance-month': (_, value) => { attendanceMonth = getMonth(attendanceMonth || today().slice(0, 7), Number(value)); render(); },
    'attendance-recent': () => { attendanceMonth = ''; render(); },
    'shoot-month': (_, value) => { shootMonth = getMonth(shootMonth || today().slice(0, 7), Number(value)); render(); },
    'shoot-today': () => { shootMonth = ''; render(); },
    'time-request': (_, value) => requestForm('time', value),
    'leave-request': () => requestForm('leave', today()),
    'hr-settings': settingsForm,
    'holiday-edit': (_, value) => holidayForm(value),
    'holiday-remove': (button) => {
      if (confirm('Remove this holiday from the company calendar?')) {
        applyAction(button, 'hr/holidays', { day: button.form.elements.day.value, remove: true }, 'Holiday removed.', true);
      }
    },
    'payslip-edit': (_, __, id) => payslipForm(id),
    'announcement-edit': (_, __, id) => announcementForm(id),
    'announcement-remove': (button, _, id) => {
      if (confirm('Remove this announcement?')) applyAction(button, 'hr/announcements', { id, remove: true }, 'Announcement removed.', true);
    },
    'work-log': logForm,
    'block-task': (_, __, id) => blockForm(state().tasks.find((task) => task.id === id)),
    'hr-approve': (button, _, id) => applyAction(button, 'hr/review', { id, status: 'approved' }, 'Request approved.'),
    'hr-decline': (button, _, id) => applyAction(button, 'hr/review', { id, status: 'declined' }, 'Request declined.'),
    'hr-cancel': (button, _, id) => applyAction(button, 'hr/review', { id, status: 'cancelled' }, 'Request cancelled.'),
  };
  const filters = {
    'hr-attendance-person': (value) => { attendancePerson = value; },
    'hr-shoot-filter': (value) => { shootFilter = value; },
    'hr-task-filter': (value) => { taskFilter = value; },
  };

  function hoursToday() {
    const { hrSettings, holidays, attendance, workPeriods, hrRequests } = state();
    return dailyHours({ attendance: personal(attendance), periods: workPeriods, requests: personal(hrRequests), settings: hrSettings,
      holidays, employee: actor(), date: today(), now: Date.now() });
  }

  return {
    dashboard, attendance, leave, shootCalendar, taskBoard, workLog, payroll, announcements, approvals, actions, filters,
    todayClock() {
      return elapsedClock(hoursToday().actual);
    },
    workTarget() {
      const { required, remaining, overtime } = hoursToday();
      return { required, remaining, aboveTarget: overtime };
    },
    timeRequestButton,
    officeHours() {
      const settings = state().hrSettings;
      if (!settings?.work_start) return '';
      return `Office ${time(Date.parse(today() + 'T' + settings.work_start + ':00+05:30'))} – ${time(Date.parse(today() + 'T' + settings.work_end + ':00+05:30'))} IST`;
    },
    reset() {
      attendanceMonth = attendancePerson = shootMonth = '';
      shootFilter = taskFilter = 'all';
    },
  };
}
