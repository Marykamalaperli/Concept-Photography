import { availableShoots, fenceRadius, presenceAt, returnSite, shootSite } from './attendance-policy.js';

const main = document.querySelector('main');
const sidebar = document.querySelector('#sidebar');
const topbar = document.querySelector('#topbar');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const zone = 'Asia/Kolkata';
const pagesMode = document.querySelector('meta[name="concept-mode"]')?.content === 'pages';
const demo = pagesMode ? import('./pages-demo.js') : null;
const studioTime = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
const studioDate = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' });
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const tickingTime = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit' });
const navigation = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['team', 'Team', 'users'],
  ['schedule', 'Schedule', 'calendar-days'],
  ['tasks', 'Tasks', 'list-todo'],
  ['attendance', 'Attendance', 'clock-3'],
  ['notifications', 'Notifications', 'bell'],
];
const categories = {
  'Photo shoot': ['camera', 'peach'],
  Editing: ['image', 'lavender'],
  Planning: ['clipboard-list', 'sage'],
  Studio: ['aperture', 'sand'],
  Other: ['briefcase', 'neutral'],
};

let state = { office: null, employees: [], tasks: [], sessions: [], attendance: [], reminders: [] };
let snapshot;
let actorId = Number(localStorage.getItem('concept-employee'));
let page = currentPage();
let taskFilter = 'all';
let scheduleFilter = 'today';
let employeeFilter = 'all';
let mobileMenu = false;
let pending = false;
let loading = false;
let refreshVersion = 0;
let displayedDate;
let toastTimer;
let clockTarget = '';
let permissionGranted = false;
let readingLocation = false;
let watcher;
let lastFix;
let observing = false;
let shownShootIds = '';

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const icon = (name) => `<i class="icon" aria-hidden="true" style="--icon:url('./icons/${name}.svg')"></i>`;
const tile = (name, color) => `<span class="tile ${color}">${icon(name)}</span>`;
const employee = (id) => state.employees.find((person) => person.id === id);
const actor = () => employee(actorId);
const manager = () => Boolean(actor()?.is_admin);
const latestShift = () => state.attendance.find((shift) => shift.employee_id === actorId);
const checkInShoots = () => availableShoots(state.tasks, actorId, Date.now());
const shootIds = () => checkInShoots().map((task) => task.id).join(',');
const reminders = () => state.reminders.filter((notice) => notice.employee_id === actorId);
const shiftFor = (id) => state.attendance.find((shift) => shift.employee_id === id && shift.clock_out === null);
const sessionsFor = (task) => state.sessions.filter((session) => session.task_id === task.id);
const activeSession = (task) => sessionsFor(task).find((session) => session.end_at === null);
const time = (value) => studioTime.format(value);
const day = (value) => dateKey.format(value);
const today = () => day(Date.now());
const tag = (label, color) => `<span class="tag ${color}"><span class="dot"></span>${label}</span>`;

function currentPage() {
  const hash = window.location.hash.slice(1);
  return navigation.some(([key]) => key === hash) ? hash : 'dashboard';
}

function avatar(person) {
  if (!person) return '';
  const letters = person.name.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  return `<span class="avatar ${e(person.color)}" aria-hidden="true">${e(letters)}</span>`;
}

function duration(milliseconds, precise = false) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (seconds > 0 && minutes === 0 && !precise) return `${seconds}s`;
  if (precise) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${minutes}m`;
}

function elapsed(task, now = Date.now()) {
  const total = sessionsFor(task).reduce((sum, entry) => sum + (entry.end_at ?? now) - entry.start_at, 0);
  return duration(total, Boolean(activeSession(task)));
}

function taskStatus(task) {
  if (task.completed_at) return tag('Completed', 'sage');
  if (activeSession(task)) return tag('In progress', 'lavender');
  if (sessionsFor(task).length) return tag('Paused', 'sand');
  return tag('Scheduled', 'neutral');
}

function heading(title, copy, action = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${copy}</p></div>${action}</div>`;
}

function actionButton(label, action, symbol, kind = 'primary') {
  return `<button type="button" class="btn ${kind}" data-action="${action}">${icon(symbol)}${label}</button>`;
}

function viewLink(route, label) {
  return `<a href="#${route}" class="text-link">${label}${icon('arrow-right')}</a>`;
}

function empty(message) {
  return `<p class="empty">${message}</p>`;
}

function renderChrome() {
  const person = actor();
  const unread = reminders().filter((notice) => !notice.read_at).length;
  const section = navigation.find(([key]) => key === page)[1];
  sidebar.classList.toggle('open', mobileMenu);
  sidebar.innerHTML = `
    <a class="brand" href="#dashboard" aria-label="Concept Photography dashboard">
      <span class="brand-mark">${icon('camera')}</span><span><strong>Concept</strong><small>Photography</small></span>
    </a>
    <p class="nav-label">Workspace</p>
    <nav class="nav" aria-label="Workspace">
      ${navigation.map(([key, label, symbol]) => `<a href="#${key}" class="nav-link ${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>
        ${icon(symbol)}${label}${key === 'notifications' && unread ? `<span class="nav-count">${unread}</span>` : ''}
      </a>`).join('')}
    </nav>
    <div class="sidebar-foot">${icon('aperture')}<div><strong>Concept Photography</strong><small>${pagesMode ? 'Browser demo' : 'Studio workspace'} · IST</small></div></div>`;
  topbar.innerHTML = `
    <div class="breadcrumb">
      <button type="button" class="icon-button menu-button" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="${mobileMenu}" data-action="menu">${icon('menu')}</button>
      <span class="workspace">${pagesMode ? 'Browser demo' : 'Workspace'}</span><span class="trail">${icon('chevron-right')}</span><strong>${section}</strong>
    </div>
    <div class="top-actions">
      <a href="#notifications" class="icon-button" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${icon('bell')}${unread ? '<span class="bell-dot"></span>' : ''}</a>
      ${person ? `<div class="profile">
        <div class="profile-head">${avatar(person)}<div><div class="profile-name">${e(person.name)}</div><div class="profile-role">${e(person.role)}</div></div>${icon('chevron-down')}</div>
        <select id="actor" aria-label="Switch employee">${personOptions(actorId)}</select>
      </div>` : ''}
    </div>`;
}

function personOptions(selected) {
  return state.employees.map((person) => `<option value="${person.id}" ${person.id === selected ? 'selected' : ''}>${e(person.name)}</option>`).join('');
}

function scheduleRow(task) {
  const [symbol, tone] = categories[task.category];
  return `<button type="button" class="schedule-row" data-action="details" data-id="${task.id}">
    <span class="schedule-time">${time(task.start_at)}</span>
    ${tile(symbol, tone)}
    <span><span class="schedule-title">${e(task.title)}</span><span class="schedule-meta">${e(employee(task.employee_id)?.name)} · ${e(task.location)}</span></span>
    ${taskStatus(task)}
  </button>`;
}

function clockCard() {
  const shift = shiftFor(actorId);
  const last = latestShift();
  const shiftTime = shift?.clock_in ?? last?.clock_out;
  const boundSite = shift?.site ? JSON.parse(shift.site) : state.office;
  const sites = checkInShoots();
  if (clockTarget && !sites.some((task) => String(task.id) === clockTarget)) clockTarget = '';
  if (!clockTarget && !state.office && sites.length) clockTarget = String(sites[0].id);
  const canClock = Boolean(shift ? boundSite : state.office || sites.length);
  return `<section class="panel">
    <div class="panel-head">
      <div><h2>Time Clock</h2><p>${actor() ? e(actor().name) : 'Select an employee'}</p></div>
      ${shift ? tag('Clocked in', 'sage') : tag('Clocked out', 'neutral')}
    </div>
    <div class="clock-body">
      <div class="clock-face" id="clock-face"></div>
      <div class="clock-date" id="clock-date"></div>
      ${!shift && sites.length ? `<label class="clock-site">Check-in site
        <select id="clock-target">
          ${state.office ? `<option value="">${e(state.office.name)}</option>` : ''}
          ${sites.map((task) => `<option value="${task.id}" ${String(task.id) === clockTarget ? 'selected' : ''}>${e(task.title)} · ${e(task.location)}</option>`).join('')}
        </select></label>` : ''}
      ${(shift || !sites.length) && boundSite ? `<p class="bound-site">${icon('map-pin')}${e(boundSite.name)}</p>` : ''}
      ${canClock ? actionButton(shift ? 'Clock Out' : 'Clock In', 'clock', shift ? 'log-out' : 'log-in') : ''}
      ${!actor() ? actionButton('Add Employee', 'new-employee', 'user-plus') : ''}
      <p class="location-note">${icon('map-pin')}${canClock ? `GPS must verify you are within ${fenceRadius} m of the work site` : 'No check-in site is available. Ask your studio manager.'}</p>
      <p class="location-watch" id="location-watch" role="status" hidden></p>
      ${(shift?.site || last?.resume_pending) && !permissionGranted ? actionButton('Enable location tracking', 'enable-location', 'locate-fixed', 'secondary') : ''}
    </div>
    ${last ? `<div class="clock-summary">
      <div><small>${shift ? 'Clocked in at' : 'Last clock-out'}</small><strong>${shortDate.format(shiftTime)} · ${time(shiftTime)}</strong></div>
      <div><small>${shift ? 'Current shift' : 'Last shift'}</small><strong ${shift ? `data-shift-start="${shift.clock_in}"` : ''}>${duration((last.clock_out ?? Date.now()) - last.clock_in)}</strong></div>
    </div>` : ''}
    ${manager() || last?.resume_pending ? `<div class="clock-tools">
      ${manager() ? actionButton('Office Location', 'office-location', 'settings', 'secondary') : ''}
      ${last?.resume_pending ? actionButton('Cancel auto return', 'cancel-return', 'x', 'secondary') : ''}
    </div>` : ''}
  </section>`;
}

function locationCell(serialized) {
  if (!serialized) return '—';
  const place = JSON.parse(serialized);
  if (place.label) return e(place.label);
  const coords = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
  return `<a class="map-link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${place.latitude}&amp;mlon=${place.longitude}">${coords}</a>
    <small>Accuracy ±${Math.round(place.accuracy)} m</small>`;
}

function attendanceTable(records, full = false) {
  if (!records.length) return empty('No attendance records yet.');
  return `<div class="table-wrap" tabindex="0" aria-label="Attendance records"><table><thead><tr>
    <th scope="col">Employee</th><th scope="col">Clock in</th><th scope="col">Clock out</th>
    <th scope="col">${full ? 'Clock-in location' : 'Location'}</th>${full ? '<th scope="col">Clock-out location</th>' : ''}
    <th scope="col">${full ? 'Time worked' : 'Status'}</th>
  </tr></thead><tbody>${records.map((shift) => {
    const person = employee(shift.employee_id);
    const siteName = shift.site ? JSON.parse(shift.site).name : '';
    return `<tr><td><div class="inline">${avatar(person)}<div><strong>${e(person?.name)}</strong><small>${e(person?.role)}</small></div></div></td>
      <td>${time(shift.clock_in)}<small>${shortDate.format(shift.clock_in)}${shift.in_reason === 'geofence' ? ' · Auto return' : ''}</small></td>
      <td>${shift.clock_out ? `${time(shift.clock_out)}<small>${shortDate.format(shift.clock_out)}${shift.out_reason === 'geofence' ? ' · Left site' : ''}</small>` : '—'}</td>
      <td>${siteName ? `<strong>${e(siteName)}</strong><br>` : ''}${locationCell(shift.in_location)}</td>${full ? `<td>${locationCell(shift.out_location)}</td>` : ''}
      <td>${full && shift.clock_out ? duration(shift.clock_out - shift.clock_in) : shift.clock_out ? tag('Clocked out', 'neutral') : tag('Clocked in', 'sage')}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function dashboard() {
  const person = actor();
  const datedTasks = state.tasks.filter((task) => day(task.start_at) === today());
  const completed = state.tasks.filter((task) => task.completed_at && day(task.completed_at) === today()).length;
  const stats = [
    ['Team Members', state.employees.length, 'users', 'peach'],
    ['Clocked In', state.attendance.filter((shift) => !shift.clock_out).length, 'clock-3', 'sage'],
    ['Scheduled Today', datedTasks.length, 'calendar-days', 'lavender'],
    ['Completed Today', completed, 'circle-check', 'sand'],
  ];
  return `
    ${heading('Dashboard', pagesMode ? 'Demo data and changes stay in this browser.' : 'Manage your team, schedule, and attendance.', actionButton('New Task', 'new-task', 'plus'))}
    <section class="hero" aria-label="Studio dashboard">
      <div class="hero-date">${icon('calendar-days')} ${studioDate.format(Date.now())}</div>
      <h2>${person ? `Welcome back, ${e(person.name.split(/\s+/)[0])}` : 'Welcome to the studio'}</h2>
      <p>${datedTasks.length ? `${datedTasks.length} ${datedTasks.length === 1 ? 'task is' : 'tasks are'} scheduled for the studio today.` : 'There are no tasks on the studio schedule today.'}</p>
    </section>
    <section class="stats" aria-label="Team overview">${stats.map(([label, value, symbol, color]) => `
      <article class="stat">${tile(symbol, color)}<div><p class="stat-label">${label}</p><p class="stat-value">${value}</p></div></article>`).join('')}</section>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Today’s Schedule</h2><p>Assignments and shoot times</p></div>${viewLink('schedule', 'View schedule')}</div>
        ${datedTasks.length ? datedTasks.slice(0, 5).map((task) => scheduleRow(task)).join('') : empty('Nothing scheduled for today.')}
      </section>
      ${clockCard()}
    </div>
    <section class="panel">
      <div class="panel-head"><div><h2>Recent Attendance</h2><p>Latest studio clock-ins and clock-outs</p></div>${viewLink('attendance', 'View attendance')}</div>
      ${attendanceTable(state.attendance.slice(0, 4))}
    </section>`;
}

function teamPage() {
  return `${heading('Team', 'Manage the people in your studio workspace.', actionButton('Add Employee', 'new-employee', 'user-plus'))}
    ${state.employees.length ? `<div class="columns">${state.employees.map((person) => `
      <article class="panel employee-card">
        <div class="panel-head"><div class="inline">${avatar(person)}<div><h2>${e(person.name)}</h2><p>${e(person.role)}</p></div></div>
          ${shiftFor(person.id) ? tag('Clocked in', 'sage') : ''}
        </div>
        <p class="muted employee-email">${e(person.email)}</p><div class="card-divider"></div>
        <p class="muted employee-email">${state.tasks.filter((task) => task.employee_id === person.id && !task.completed_at).length} open task(s)</p>
      </article>`).join('')}</div>` : empty('Add an employee to start assigning work.')}`;
}

function filters(scope, choices, selected) {
  return choices.map(([key, label]) => `<button class="filter ${key === selected ? 'active' : ''}" type="button" aria-pressed="${key === selected}" data-action="${scope}-filter" data-value="${key}">${label}</button>`).join('');
}

function schedulePage() {
  const week = day(Date.now() + 6 * 86400000);
  const matches = state.tasks.filter((task) => {
    const date = day(task.start_at);
    return (employeeFilter === 'all' || task.employee_id === Number(employeeFilter)) &&
      (scheduleFilter === 'all' || date === today() || (scheduleFilter === 'week' && date > today() && date <= week));
  });
  const groups = Map.groupBy(matches, (task) => day(task.start_at));
  return `${heading('Schedule', 'See scheduled tasks and shoots in studio time.', actionButton('New Task', 'new-task', 'plus'))}
    <div class="filter-bar">
      ${filters('schedule', [['today', 'Today'], ['week', 'Next 7 days'], ['all', 'All dates']], scheduleFilter)}
      <select id="schedule-employee" aria-label="Filter schedule by employee">
        <option value="all">All employees</option>${personOptions(Number(employeeFilter))}
      </select>
    </div>
    ${matches.length ? Array.from(groups.values(), (tasks) => `<section class="panel schedule-day">
      <div class="panel-head"><div><h2>${studioDate.format(tasks[0].start_at)}</h2><p>${tasks.length} scheduled</p></div></div>
      ${tasks.map((task) => scheduleRow(task)).join('')}
    </section>`).join('') : empty('There are no scheduled tasks for this view.')}`;
}

function taskControls(task) {
  const site = shootSite(task);
  if (task.category === 'Photo shoot' && !site && !task.completed_at) {
    return '<p class="task-location-note">The studio manager needs to set the shoot location before check-in.</p>';
  }
  if (site && task.employee_id === actorId) {
    const shift = shiftFor(actorId);
    const atShoot = shift?.site && JSON.parse(shift.site).taskId === task.id;
    const end = atShoot
      ? `<button type="button" class="btn primary" data-action="clock" data-id="${task.id}">${icon('log-out')}Clock Out of Shoot</button>`
      : '';
    if (task.completed_at) return end;
    if (atShoot) {
      return end + `<button type="button" class="btn secondary" data-action="task-timer" data-value="complete" data-id="${task.id}">${icon('check')}Mark complete</button>`;
    }
    if (!shift && checkInShoots().some((item) => item.id === task.id)) {
      return `<button type="button" class="btn primary" data-action="clock" data-id="${task.id}">${icon('log-in')}Clock In at Shoot</button>`;
    }
    const outsideWindow = Date.now() < task.start_at - 30 * 60_000
      ? 'Shoot check-in opens 30 minutes before the scheduled start.'
      : 'The scheduled check-in window has ended.';
    return `<p class="task-location-note">${shift ? 'Clock out of your current site before starting this shoot.' : outsideWindow}</p>`;
  }
  if (task.completed_at) return '';
  if (task.employee_id !== actorId) return `<button type="button" class="btn secondary" data-action="switch" data-id="${task.employee_id}" data-value="${task.id}">${icon('user-round')}Switch to assignee</button>`;
  const active = activeSession(task);
  return `<button type="button" class="btn primary" data-action="task-timer" data-value="${active ? 'pause' : 'start'}" data-id="${task.id}">
    ${icon(active ? 'pause' : 'play')}${active ? 'Pause timer' : sessionsFor(task).length ? 'Resume timer' : 'Start timer'}
  </button>
  <button type="button" class="btn secondary" data-action="task-timer" data-value="complete" data-id="${task.id}">${icon('check')}Mark complete</button>`;
}

function taskCard(task, inDialog = false) {
  const site = shootSite(task);
  const editSite = manager() && task.category === 'Photo shoot'
    ? `<button type="button" class="btn secondary" data-action="shoot-location" data-id="${task.id}">${icon('map-pin')}${site ? 'Edit Shoot Location' : 'Set Shoot Location'}</button>`
    : '';
  return `<article class="${inDialog ? '' : 'panel task-card'}">
    ${inDialog ? '' : `<div class="panel-head"><div><h2>${e(task.title)}</h2><p>${e(task.category)}</p></div>${taskStatus(task)}</div>`}
    <div class="task-details">
      <div class="inline">${icon('user-round')}${e(employee(task.employee_id)?.name)}</div>
      <div class="inline">${icon('calendar-days')}${shortDate.format(task.start_at)} · ${time(task.start_at)} IST</div>
      <div class="inline">${icon('map-pin')}${e(task.location)}${site ? ` · ${fenceRadius} m GPS boundary` : ''}</div>
    </div>
    <div class="task-times">
      <div><small>Estimated duration</small><strong>${duration(task.estimate * 60000)}</strong></div>
      <div><small>Time tracked</small><strong ${activeSession(task) ? `data-elapsed="${task.id}"` : ''}>${elapsed(task)}</strong></div>
    </div>
    <div class="card-actions">${taskControls(task)}${editSite}</div>
  </article>`;
}

function tasksPage() {
  const tasks = state.tasks.filter((task) => {
    if (taskFilter === 'mine') return task.employee_id === actorId;
    if (taskFilter === 'open') return !task.completed_at;
    if (taskFilter === 'done') return Boolean(task.completed_at);
    return true;
  });
  return `${heading('Tasks', 'Assign studio work and compare estimates with tracked time.', actionButton('New Task', 'new-task', 'plus'))}
    <div class="filter-bar">${filters('task', [['all', 'All tasks'], ['mine', 'My tasks'], ['open', 'Open'], ['done', 'Completed']], taskFilter)}</div>
    ${tasks.length ? `<div class="task-grid">${tasks.map((task) => taskCard(task)).join('')}</div>` : empty('No tasks match this view.')}`;
}

function attendancePage() {
  return `${heading('Attendance', 'Record shift times and verify where the team checked in and out.')}
    <div class="dashboard-grid attendance-page">${clockCard()}<section class="panel">
      <div class="panel-head"><div><h2>Attendance Log</h2><p>Clock records and recorded locations</p></div></div>
      ${attendanceTable(state.attendance, true)}
    </section></div>`;
}

function notificationsPage() {
  const notices = reminders();
  const showEnable = 'Notification' in window && Notification.permission !== 'granted';
  return `${heading('Notifications', 'Work reminders arrive up to 30 minutes before a scheduled task.', showEnable ? actionButton('Enable browser alerts', 'alerts', 'bell', 'secondary') : '')}
    <section class="panel">
      <div class="panel-head"><div><h2>${actor() ? `Reminders for ${e(actor().name)}` : 'Work reminders'}</h2><p>Browser alerts are available while this workspace is open.</p></div>
        ${notices.some((notice) => !notice.read_at) ? actionButton('Mark all read', 'read', 'check-check', 'secondary') : ''}</div>
      ${notices.length ? notices.map((notice) => `<div class="notice-row">
        ${tile('bell', 'peach')}<div><h3>${e(notice.title)}</h3>
        <p>Scheduled for ${shortDate.format(notice.start_at)} at ${time(notice.start_at)} IST</p></div>${notice.read_at ? '' : tag('Unread', 'peach')}
      </div>`).join('') : empty('No reminders yet.')}
    </section>`;
}

const pages = { dashboard, team: teamPage, schedule: schedulePage, tasks: tasksPage, attendance: attendancePage, notifications: notificationsPage };

function render() {
  displayedDate = today();
  shownShootIds = shootIds();
  renderChrome();
  main.innerHTML = pages[page]();
  if (dialog.open && dialog.dataset.taskId) {
    const task = state.tasks.find((item) => item.id === Number(dialog.dataset.taskId));
    if (task) taskDialog(task);
  }
  updateTracking();
  tick();
}

function tick() {
  if (snapshot && (displayedDate !== today() || shownShootIds !== shootIds())) {
    render();
    return;
  }
  processLocation();
  const shiftTime = document.querySelector('[data-shift-start]');
  if (shiftTime) shiftTime.textContent = duration(Date.now() - Number(shiftTime.dataset.shiftStart));
  const face = document.querySelector('#clock-face');
  const date = document.querySelector('#clock-date');
  if (face && date) {
    const now = Date.now();
    const parts = tickingTime.formatToParts(now);
    const period = parts.find((part) => part.type === 'dayPeriod').value;
    const digits = parts.filter((part) => part.type !== 'dayPeriod').map((part) => part.value).join('').trim();
    face.innerHTML = `${digits}<small>${period}</small>`;
    date.textContent = studioDate.format(now) + ' · IST';
  }
  document.querySelectorAll('[data-elapsed]').forEach((element) => {
    const task = state.tasks.find((item) => item.id === Number(element.dataset.elapsed));
    if (task) element.textContent = elapsed(task);
  });
}

async function request(path, body) {
  if (demo) return (await demo).demoRequest(path, body);
  const response = await fetch('/api/' + path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

async function refresh({ force = false, notify = true } = {}) {
  if (loading && !force) return;
  const version = ++refreshVersion;
  loading = true;
  try {
    const fresh = await request('state');
    if (version !== refreshVersion) return;
    const fingerprint = JSON.stringify(fresh);
    if (snapshot === fingerprint && !force) return;
    const oldIds = new Set(reminders().map((notice) => notice.task_id));
    const first = snapshot === undefined;
    snapshot = fingerprint;
    state = fresh;
    if (!actor()) actorId = state.employees[0]?.id;
    render();
    if (!first && notify) {
      const freshNotices = reminders().filter((notice) => !notice.read_at && !oldIds.has(notice.task_id));
      if (freshNotices.length) {
        showToast(`Upcoming work: ${freshNotices.map((notice) => notice.title).join(', ')}`);
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const notice of freshNotices) {
            try {
              new Notification('Concept Photography · Work reminder', {
                body: `${notice.title} starts at ${time(notice.start_at)} IST.`,
                tag: 'concept-task-' + notice.task_id,
              });
            } catch {
              // The in-app reminder remains available on browsers that disallow desktop alerts.
            }
          }
        }
      }
    }
  } finally {
    if (version === refreshVersion) loading = false;
  }
}

function setActor(id) {
  actorId = id;
  clockTarget = '';
  localStorage.setItem('concept-employee', String(id));
  if (dialog.open) dialog.close();
  render();
}

function openDialog(title, subtitle, body) {
  delete dialog.dataset.taskId;
  dialog.innerHTML = `<div class="dialog-inner"><div class="panel-head">
    <div><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div>
    <button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('x')}</button>
  </div>${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function entryForm(kind, fields, label) {
  return `<form data-form="${kind}"><div class="form-grid">${fields}</div><p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="btn secondary" data-action="close">Cancel</button><button class="btn primary" type="submit">${label}</button></div>
  </form>`;
}

function employeeForm() {
  openDialog('Add Employee', 'Add a team member who can receive assignments.', entryForm('employees', `
    <label class="full">Full name<input name="name" required maxlength="100" placeholder="e.g. Jamie Chen"></label>
    <label class="full">Role<input name="role" required maxlength="100" placeholder="e.g. Lead Photographer"></label>
    <label class="full">Email<input name="email" type="email" required maxlength="254" placeholder="name@example.com"></label>`, 'Add Employee'));
}

function coordinateFields(site = {}) {
  return `<label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required value="${e(site.latitude)}"></label>
    <label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required value="${e(site.longitude)}"></label>`;
}

function locationForm(task) {
  const site = task ? shootSite(task) : state.office;
  const field = task ? 'location' : 'name';
  const label = task ? 'Shoot location' : 'Office name';
  openDialog(task ? 'Shoot Location' : 'Office Location', `Set the center of the ${fenceRadius} m clock-in and clock-out boundary.`,
    entryForm(task ? 'task-site' : 'office', `
      ${task ? `<input type="hidden" name="taskId" value="${task.id}">` : ''}
      <label class="full">${label}<input name="${field}" required maxlength="100" value="${e(task?.location ?? site?.name)}"></label>
      ${coordinateFields(site ?? {})}
      <div class="full">${actionButton('Use my current location', 'fill-location', 'locate-fixed', 'secondary')}</div>
    `, 'Save Location'));
}

function taskForm() {
  if (!state.employees.length) {
    employeeForm();
    showToast('Add an employee before creating a task.');
    return;
  }
  const options = Object.keys(categories).filter((category) => manager() || category !== 'Photo shoot');
  openDialog('New Task', 'The assignee receives a reminder before the scheduled start.', entryForm('tasks', `
    <label class="full">Task title<input name="title" required maxlength="100" placeholder="e.g. Product photography session"></label>
    <label>Assigned to<select name="employeeId" required>${personOptions(actorId)}</select></label>
    <label>Category<select name="category" required>${options.map((category) => `<option>${category}</option>`).join('')}</select></label>
    <label>Start date<input type="date" name="startDate" required value="${today()}"></label>
    <label>Start time (IST)<input type="time" name="startTime" required></label>
    <label>Estimate (minutes)<input type="number" name="estimate" required min="1" max="1440" value="60"></label>
    <label>Work location<input name="location" required maxlength="100" placeholder="e.g. Studio A"></label>
    ${manager() ? `<fieldset class="full coordinate-fields"><legend>Shoot check-in location</legend>
      ${coordinateFields()}
      <div class="full">${actionButton('Use my current location', 'fill-location', 'locate-fixed', 'secondary')}</div>
    </fieldset>` : ''}`, 'Create Task'));
}

function taskDialog(task) {
  openDialog(e(task.title), e(task.category), taskCard(task, true));
  dialog.dataset.taskId = task.id;
}

const locationOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };

function toFix({ coords, timestamp }) {
  return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: timestamp };
}

function locationError(error) {
  return error.code === 1
    ? 'Location permission was denied. Allow location access to record attendance.'
    : 'Your location was unavailable. Check your device location settings and try again.';
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error('Open the workspace over HTTPS or localhost to use location.'));
      return;
    }
    readingLocation = true;
    stopTracking();
    navigator.geolocation.getCurrentPosition((position) => {
      readingLocation = false;
      permissionGranted = true;
      resolve(toFix(position));
    }, (error) => {
      readingLocation = false;
      if (error.code === 1) permissionGranted = false;
      reject(new Error(locationError(error)));
    }, locationOptions);
  });
}

function trackingTarget() {
  const latest = latestShift();
  const current = latest?.clock_out === null;
  const site = current
    ? (latest.site ? JSON.parse(latest.site) : null)
    : returnSite(latest, state.office, state.tasks, actorId, Date.now());
  return site ? { site, current, shiftId: latest.id } : null;
}

function setWatchStatus(message) {
  const element = document.querySelector('#location-watch');
  if (element && element.textContent !== message) element.textContent = message;
  if (element) element.hidden = !message;
}

function stopTracking() {
  if (watcher) navigator.geolocation.clearWatch(watcher.id);
  watcher = undefined;
  lastFix = undefined;
}

function updateTracking() {
  if (readingLocation) return;
  const target = trackingTarget();
  const shouldWatch = target && permissionGranted && window.isSecureContext && navigator.geolocation;
  if (watcher && (!shouldWatch || watcher.employeeId !== actorId)) stopTracking();
  if (!shouldWatch) {
    const message = target ? 'Enable location tracking to record departures and returns.'
      : latestShift()?.resume_pending ? 'Auto return is unavailable for this site. You can clock in at an eligible site.'
      : '';
    setWatchStatus(message);
    return;
  }
  if (!watcher) {
    const watching = { employeeId: actorId };
    watcher = watching;
    watching.id = navigator.geolocation.watchPosition((position) => {
      if (watcher !== watching) return;
      lastFix = { location: toFix(position), employeeId: watching.employeeId };
      processLocation();
    }, (error) => {
      if (watcher !== watching) return;
      if (error.code === 1) {
        permissionGranted = false;
        render();
      }
      setWatchStatus(locationError(error));
    }, locationOptions);
  }
  setWatchStatus(target.current ? 'Location tracking is on. Keep this workspace open for automatic clock-out.'
    : 'Clocked out after leaving. Keep this workspace open to clock back in on return.');
}

async function processLocation() {
  if (!lastFix || lastFix.employeeId !== actorId || pending || observing) return;
  const target = trackingTarget();
  const { location, employeeId } = lastFix;
  lastFix = undefined;
  if (!target || Date.now() - location.capturedAt > 30_000) return;
  if (presenceAt(location, target.site) !== (target.current ? 'outside' : 'inside')) return;
  observing = true;
  try {
    const shift = await request('attendance', { employeeId, shiftId: target.shiftId, action: 'observe', location });
    await refresh({ force: true });
    if (shift && actorId === employeeId) {
      showToast(target.current ? `Clocked out automatically after leaving ${target.site.name}.`
        : `Clocked back in automatically at ${target.site.name}.`);
    }
  } catch (error) {
    setWatchStatus(error.message);
  } finally {
    observing = false;
  }
}

navigator.permissions?.query({ name: 'geolocation' }).then((permission) => {
  const syncPermission = () => {
    const granted = permission.state === 'granted';
    if (granted === permissionGranted) return;
    permissionGranted = granted;
    if (snapshot) render();
  };
  permission.addEventListener('change', syncPermission);
  syncPermission();
}).catch(() => {});

async function mutate(button, callback) {
  if (pending) return;
  pending = true;
  button.disabled = true;
  try {
    await callback();
  } catch (error) {
    showToast(error.message);
  } finally {
    pending = false;
    button.disabled = false;
    updateTracking();
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.sidebar a')) {
    mobileMenu = false;
    sidebar.classList.remove('open');
    topbar.querySelector('.menu-button')?.setAttribute('aria-expanded', 'false');
  }
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id, value } = button.dataset;
  const task = state.tasks.find((item) => item.id === Number(id));

  if (action === 'menu') {
    mobileMenu = !mobileMenu;
    sidebar.classList.toggle('open', mobileMenu);
    button.setAttribute('aria-expanded', String(mobileMenu));
  }
  if (action === 'new-task') taskForm();
  if (action === 'new-employee') employeeForm();
  if (action === 'close') dialog.close();
  if (action === 'details' && task) taskDialog(task);
  if (action === 'switch') {
    const reopen = dialog.open ? Number(value) : undefined;
    setActor(Number(id));
    if (reopen) taskDialog(state.tasks.find((item) => item.id === reopen));
    showToast(`Switched to ${actor().name}.`);
  }
  if (action === 'task-filter' || action === 'schedule-filter') {
    if (action === 'task-filter') taskFilter = value;
    else scheduleFilter = value;
    render();
    main.querySelector(`[data-action="${action}"][aria-pressed="true"]`)?.focus();
  }
  if (action === 'office-location' && manager()) locationForm();
  if (action === 'shoot-location' && manager() && task) locationForm(task);
  if (action === 'fill-location') {
    const form = button.closest('form');
    mutate(button, async () => {
      const location = await getLocation();
      if (location.accuracy > 50) throw new Error('GPS accuracy is too low to set a work site. Move outdoors and try again.');
      form.elements.latitude.value = location.latitude;
      form.elements.longitude.value = location.longitude;
    });
  }
  if (action === 'enable-location') {
    mutate(button, async () => {
      await getLocation();
      render();
    });
  }
  if (action === 'cancel-return') {
    mutate(button, async () => {
      await request('attendance', { employeeId: actorId, shiftId: latestShift()?.id, action: 'cancel-return' });
      await refresh({ force: true });
      showToast('Automatic return cancelled.');
    });
  }
  if (action === 'clock') {
    const employeeId = actorId;
    const shift = shiftFor(employeeId);
    const clockAction = shift ? 'out' : 'in';
    const taskId = id ? Number(id) : (clockTarget ? Number(clockTarget) : null);
    mutate(button, async () => {
      const label = button.lastChild.textContent;
      button.lastChild.textContent = 'Getting location…';
      try {
        const location = await getLocation();
        if (employeeId !== actorId) throw new Error('Employee changed. Try again.');
        await request('attendance', { employeeId, action: clockAction, location, taskId, shiftId: shift?.id });
        await refresh({ force: true });
        showToast(`Clocked ${clockAction}. Time and location recorded.`);
      } finally {
        button.lastChild.textContent = label;
      }
    });
  }
  if (action === 'task-timer' && task) {
    mutate(button, async () => {
      await request('task-action', { employeeId: actorId, taskId: task.id, action: value });
      await refresh({ force: true });
      showToast({ start: 'Task timer started.', pause: 'Task timer paused.', complete: 'Task marked complete.' }[value]);
    });
  }
  if (action === 'read') {
    mutate(button, async () => {
      await request('reminders/read', { employeeId: actorId });
      await refresh({ force: true });
    });
  }
  if (action === 'alerts') {
    mutate(button, async () => {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        render();
        showToast('Browser alerts enabled for upcoming work.');
      } else {
        showToast('Browser alerts are unavailable. Reminders still appear under Notifications.');
      }
    });
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'clock-target') clockTarget = event.target.value;
  if (event.target.name === 'category') {
    const coordinates = event.target.form.querySelector('.coordinate-fields');
    if (coordinates) {
      const isShoot = event.target.value === 'Photo shoot';
      coordinates.hidden = !isShoot;
      coordinates.disabled = !isShoot;
    }
  }
  if (event.target.id === 'actor') setActor(Number(event.target.value));
  if (event.target.id === 'schedule-employee') {
    employeeFilter = event.target.value;
    render();
    main.querySelector('#schedule-employee').focus();
  }
});

dialog.addEventListener('submit', (event) => {
  event.preventDefault();
  if (pending) return;
  const form = event.target;
  const kind = form.dataset.form;
  const errorNote = form.querySelector('.form-error');
  const data = { ...Object.fromEntries(new FormData(form)), actorId };
  if (kind === 'tasks') data.startAt = `${data.startDate}T${data.startTime}:00+05:30`;
  errorNote.hidden = true;
  mutate(event.submitter, async () => {
    try {
      await request(kind, data);
      dialog.close();
      if (kind === 'tasks') window.location.hash = '#tasks';
      await refresh({ force: true });
      showToast({ tasks: 'Task scheduled.', employees: 'Employee added.', office: 'Office location saved.', 'task-site': 'Shoot location saved.' }[kind]);
    } catch (error) {
      errorNote.textContent = error.message;
      errorNote.hidden = false;
    }
  });
});

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#main') return;
  page = currentPage();
  mobileMenu = false;
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
});

refresh().catch(() => {
  renderChrome();
  main.innerHTML = '<p class="empty">The workspace could not load. Refresh the page to retry.</p>';
});
setInterval(tick, 1000);
setInterval(() => {
  if (!pending) refresh().catch(() => {});
}, 15000);
