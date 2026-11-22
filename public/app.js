import { assignedTo, availableShoots, fenceRadius, presenceAt, returnSite, shootSite } from './attendance-policy.js';
import { loginView, passwordField } from './access-view.js';
import { createHrViews } from './hr-views.js';
import {
  currentPushSubscription, needsHomeScreen, preparePushWorker, subscribeToMobileAlerts, supportsMobileAlerts,
} from './mobile-alerts.js';

const apiOrigin = document.querySelector('meta[name="concept-api"]')?.content;
const sessionKey = apiOrigin && `concept-photography-session:${apiOrigin}`;
let accessToken = sessionKey ? sessionStorage.getItem(sessionKey) : null;

const main = document.querySelector('main');
const sidebar = document.querySelector('#sidebar');
const topbar = document.querySelector('#topbar');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const zone = 'Asia/Kolkata';
const studioTime = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
const studioDate = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' });
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const adminNav = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['team', 'Employees', 'users'],
  ['schedule', 'Schedule', 'calendar-days'],
  ['shoot-calendar', 'Shoot calendar', 'camera'],
  ['task-board', 'Tasks', 'columns-3'],
  ['clients', 'Clients', 'contact-round'],
  ['approvals', 'Approvals', 'clipboard-check'],
  ['finances', 'Finances', 'wallet'],
  ['attendance', 'Attendance', 'clock-3'],
  ['leave', 'Leave & holidays', 'calendar-heart'],
  ['work-log', 'Work log', 'notebook-pen'],
  ['payroll', 'Payslips', 'receipt'],
  ['announcements', 'Announcements', 'megaphone'],
  ['notifications', 'Notifications', 'bell'],
];
const employeeNav = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['schedule', 'My Schedule', 'calendar-days'],
  ['shoot-calendar', 'Shoot calendar', 'camera'],
  ['task-board', 'Tasks', 'columns-3'],
  ['work', 'Available Work', 'briefcase'],
  ['attendance', 'Attendance', 'clock-3'],
  ['leave', 'Leave & holidays', 'calendar-heart'],
  ['work-log', 'Work log', 'notebook-pen'],
  ['payroll', 'Payslips', 'receipt'],
  ['announcements', 'Announcements', 'megaphone'],
  ['notifications', 'Notifications', 'bell'],
];
const categories = {
  'Photo shoot': ['camera', 'peach'],
  Editing: ['image', 'lavender'],
  Planning: ['clipboard-list', 'sage'],
  Studio: ['aperture', 'sand'],
  Other: ['briefcase', 'neutral'],
};

const initialState = () => ({
  hrSettings: { monthly_leave: 2, week_off: 0 }, holidays: [], hrRequests: [], workLogs: [], payslips: [], announcements: [],
  office: null, employees: [], tasks: [], sessions: [], attendance: [], reminders: [], clients: [], requests: [], openWork: [], payments: [], expenses: [] });
let state = initialState();
let session = null;
let sessionVersion = 0;
let snapshot;
let actorId;
let page = 'dashboard';
let scheduleFilter = 'upcoming';
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
let mobileDevice;

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const icon = (name) => `<i class="icon" aria-hidden="true" style="--icon:url('./icons/${name}.svg')"></i>`;
const tile = (name, color) => `<span class="tile ${color}">${icon(name)}</span>`;
const employee = (id) => state.employees.find((person) => person.id === id);
const actor = () => employee(actorId);
const manager = () => Boolean(actor()?.is_admin);
const latestShift = () => state.attendance.find((shift) => shift.employee_id === actorId);
const checkInShoots = () => availableShoots(state.tasks.filter((task) => !task.is_open), actorId, Date.now());
const shootIds = () => checkInShoots().map((task) => task.id).join(',');
const reminders = () => state.reminders.filter((notice) => notice.employee_id === actorId);
const shiftFor = (id) => state.attendance.find((shift) => shift.employee_id === id && shift.clock_out === null);
const sessionsFor = (task) => state.sessions.filter((session) => session.task_id === task.id);
const activeSession = (task) => sessionsFor(task).find((session) => session.end_at === null);
const time = (value) => studioTime.format(value);
const day = (value) => dateKey.format(value);
const today = () => day(Date.now());
const tag = (label, color) => `<span class="tag ${color}"><span class="dot"></span>${label}</span>`;

const nav = () => manager() ? adminNav : employeeNav;
const pendingRequests = () => [...state.requests, ...state.hrRequests].filter((item) => item.status === 'pending');
const shoots = () => state.tasks.filter((task) => task.category === 'Photo shoot');
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const money = (paise) => rupees.format(paise / 100);
const studioTimeInput = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const studioDateTimeInput = (value) => `${day(value)}T${studioTimeInput.format(value)}`;

function shootEndLabel(task) {
  const end = task.start_at + task.estimate * 60_000;
  return `${day(end) === day(task.start_at) ? '' : `${shortDate.format(end)} · `}${time(end)}`;
}

function currentPage() {
  const hash = window.location.hash.slice(1);
  return nav().some(([key]) => key === hash) ? hash : 'dashboard';
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
  if (task.shoot_status === 'postponed') return tag('Postponed', 'sand');
  if (task.shoot_status === 'cancelled') return tag('Cancelled', 'neutral');
  if (task.blocked_reason) return tag('Blocked', 'peach');
  if (task.is_open) return tag('Open for requests', 'sand');
  if (task.completed_at) return tag('Completed', 'sage');
  if (activeSession(task)) return tag('In progress', 'lavender');
  if (sessionsFor(task).length) return tag('Paused', 'sand');
  return tag('Scheduled', 'neutral');
}

function heading(title, copy, action = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${copy}</p></div>${action}</div>`;
}

function actionButton(label, action, symbol, kind = 'primary', id = null) {
  return `<button type="button" class="btn ${kind}" data-action="${action}"${id == null ? '' : ` data-id="${id}"`}>${icon(symbol)}${label}</button>`;
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
  const section = nav().find(([key]) => key === page)[1];
  sidebar.classList.toggle('open', mobileMenu);
  sidebar.innerHTML = `
    <a class="brand" href="#dashboard" aria-label="Concept Photography dashboard">
      <img class="brand-mark" src="./brand-mark.png" width="39" height="39" alt=""><span><strong>Concept</strong><small>Photography</small></span>
    </a>
    <p class="nav-label">${manager() ? 'Studio admin' : 'Workspace'}</p>
    <nav class="nav" aria-label="Workspace">
      ${nav().map(([key, label, symbol]) => {
        const count = key === 'approvals' ? pendingRequests().length : key === 'notifications' ? unread : 0;
        return `<a href="#${key}" class="nav-link ${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>
          ${icon(symbol)}${label}${count ? `<span class="nav-count">${count}</span>` : ''}
        </a>`;
      }).join('')}
    </nav>
    <div class="sidebar-foot"><img src="./brand-mark.png" width="18" height="18" alt=""><div><strong>Concept Photography</strong><small>Studio workspace · IST</small></div></div>`;
  topbar.innerHTML = `
    <div class="breadcrumb">
      <button type="button" class="icon-button menu-button" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="${mobileMenu}" data-action="menu">${icon('menu')}</button>
      <span class="workspace">${manager() ? 'Studio admin' : 'Workspace'}</span><span class="trail">${icon('chevron-right')}</span><strong>${section}</strong>
    </div>
    <div class="top-actions">
      <a href="#notifications" class="icon-button" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${icon('bell')}${unread ? '<span class="bell-dot"></span>' : ''}</a>
      <div class="profile profile-head">${avatar(person)}<div><div class="profile-name">${e(person.name)}</div><div class="profile-role">${e(person.role)}</div></div></div>
      <button type="button" class="icon-button" aria-label="Sign out" title="Sign out" data-action="sign-out">${icon('log-out')}</button>
    </div>`;
}

function showAuthStatus(message = '') {
  const notice = main.querySelector('[data-auth-connection]');
  if (!notice) return;
  notice.hidden = !message;
  notice.querySelector('[role="status"]').textContent = message;
}

function loginPage() {
  stopTracking();
  document.body.classList.add('signed-out');
  sidebar.innerHTML = '';
  topbar.innerHTML = '';
  main.innerHTML = loginView();
}

main.addEventListener('click', (event) => {
  if (event.target.closest('[data-auth-retry]') && !pending) loadSession();
});

function priority(task) {
  return task.priority && !task.completed_at ? tag('Priority', 'peach') : '';
}

function scheduleRow(task) {
  const [symbol, tone] = categories[task.category];
  const lead = employee(task.employee_id)?.name;
  const owner = task.is_open ? 'Available for requests' : task.crew?.length ? task.crew.map((member) => member.name).join(', ') : lead;
  return `<button type="button" class="schedule-row" data-action="details" data-id="${task.id}">
    <span class="schedule-time">${shortDate.format(task.start_at)}<br>${time(task.start_at)}</span>
    ${tile(symbol, tone)}
    <span><span class="schedule-title">${e(task.title)}</span><span class="schedule-meta">${e(manager() ? owner : task.client_name || task.category)} · ${e(task.location)}</span></span>
    <span class="row-tags">${priority(task)}${taskStatus(task)}</span>
  </button>`;
}

function metrics(items) {
  return `<section class="stats" aria-label="Summary">${items.map(([label, value, symbol, color]) => `
    <article class="stat">${tile(symbol, color)}<div><p class="stat-label">${label}</p><p class="stat-value">${value}</p></div></article>`).join('')}</section>`;
}

function totals() {
  const income = shoots().reduce((sum, task) => sum + (task.shoot_status === 'cancelled' ? paidFor(task.id) : task.income_paise), 0);
  const received = state.payments.reduce((sum, payment) => sum + payment.amount_paise, 0);
  const expenses = state.expenses.reduce((sum, expense) => sum + expense.amount_paise, 0);
  return { income, received, expenses, outstanding: income - received, net: received - expenses };
}

function officeCard() {
  const office = state.office;
  return `<section class="panel office-panel"><div class="panel-head">
    <div class="inline">${tile('map-pin', 'peach')}<div><h2>Company location</h2>
      <p>${office ? e(office.name) + ' · 100 m attendance boundary' : 'Paste a Google Maps link to enable office attendance.'}</p></div></div>
  </div>
  <div class="card-actions">${actionButton(office ? 'Edit location' : 'Set company location', 'office-location', 'map-pin', 'secondary')}
    ${mapLinks(office)}
  </div></section>`;
}

function externalLink(url, label) {
  return `<a class="text-link" href="${e(url)}" target="_blank" rel="noopener noreferrer">${label}${icon('external-link')}</a>`;
}

function openStreetMapUrl({ latitude, longitude }) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

function mapLinks(site) {
  if (!site) return '';
  const pin = encodeURIComponent(`${site.latitude},${site.longitude}`);
  return `${externalLink(`https://www.google.com/maps/search/?api=1&query=${pin}`, 'Open in Google Maps')}
    ${externalLink(openStreetMapUrl(site), 'OpenStreetMap')}`;
}

function dashboard() {
  if (!manager()) return hrViews.dashboard();
  const now = Date.now();
  const upcoming = state.tasks.filter((task) => task.shoot_status === 'booked' && !task.completed_at && task.start_at + task.estimate * 60_000 > now);
  const { received, outstanding, expenses, net } = totals();
  return `
    ${heading('Admin Dashboard', 'Manage the studio’s people, shoots, and finances.', actionButton('Schedule shoot', 'new-shoot', 'plus'))}
    <section class="hero" aria-label="Studio overview">
      <div class="hero-date">${icon('calendar-days')} ${studioDate.format(now)}</div>
      <h2>Welcome, ${e(actor().name.split(/\s+/)[0])}</h2>
      <p>Concept Photography studio overview</p>
    </section>
    ${metrics([
      ['Employees', state.employees.filter((person) => !person.is_admin).length, 'users', 'peach'],
      ['Upcoming shoots', upcoming.filter((task) => task.category === 'Photo shoot').length, 'calendar-days', 'lavender'],
      ['Pending approvals', pendingRequests().length, 'clipboard-check', 'sand'],
      ['Payments received', money(received), 'wallet', 'sage'],
    ])}
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Upcoming schedule</h2><p>Assigned work appears first.</p></div>${viewLink('schedule', 'View schedule')}</div>
        ${upcoming.length ? upcoming.slice(0, 5).map(scheduleRow).join('') : empty('No upcoming shoots or tasks.')}
      </section>
      <div class="stack">${officeCard()}
        <section class="panel">
          <div class="panel-head"><div><h2>Finance overview</h2><p>All transactions recorded to date</p></div>${viewLink('finances', 'View finances')}</div>
          <dl class="balance-list"><div><dt>Pending payments</dt><dd>${money(outstanding)}</dd></div>
          <div><dt>Expenses</dt><dd>${money(expenses)}</dd></div><div><dt>Cash profit</dt><dd>${money(net)}</dd></div></dl>
        </section>
      </div>
    </div>`;
}

function clockCard() {
  const shift = shiftFor(actorId);
  const last = latestShift();
  const boundSite = shift?.site ? JSON.parse(shift.site) : state.office;
  const sites = checkInShoots();
  if (clockTarget && !sites.some((task) => String(task.id) === clockTarget)) clockTarget = '';
  if (!clockTarget && !state.office && sites.length) clockTarget = String(sites[0].id);
  const canClockIn = !shift && Boolean(state.office || sites.length);
  const canClockOut = Boolean(shift && boundSite);
  const officeHours = hrViews.officeHours();
  const clockButton = (label, symbol, available) => available ? actionButton(label, 'clock', symbol) :
    `<button type="button" class="btn secondary" disabled>${icon(symbol)}${label}</button>`;
  return `<section class="panel hr-panel hr-clock">
    <header class="hr-panel-head"><h2>Time clock</h2>${shift ? tag('Checked in', 'sage') : tag('Checked out', 'neutral')}</header>
    <div class="hr-panel-body">
      <p class="hr-time-label">Today’s hours</p><div class="hr-timer" id="today-hours">${hrViews.todayClock()}</div>
      ${!shift && sites.length ? `<label class="clock-site">Check-in site
        <select id="clock-target">
          ${state.office ? '<option value="">' + e(state.office.name) + '</option>' : ''}
          ${sites.map((task) => `<option value="${task.id}" ${String(task.id) === clockTarget ? 'selected' : ''}>${e(task.title)} · ${e(task.location)}</option>`).join('')}
        </select></label>` : ''}
      ${(shift || !sites.length) && boundSite ? `<p class="hr-clock-site">${icon('map-pin')}${e(boundSite.name)}</p>` : ''}
      <div class="hr-clock-buttons">${clockButton('Check in', 'log-in', canClockIn)}${clockButton('Check out', 'log-out', canClockOut)}</div>
      ${officeHours ? `<p class="hr-muted">${officeHours}</p>` : ''}
      <p class="hr-muted">${canClockIn || canClockOut ? `GPS verification within ${fenceRadius} m is required.` : 'No check-in site is available.'}</p>
      <p class="location-watch" id="location-watch" role="status" hidden></p>
      ${(shift?.site || last?.resume_pending) && !permissionGranted ? actionButton('Enable location tracking', 'enable-location', 'locate-fixed', 'secondary') : ''}
      ${!shift ? hrViews.timeRequestButton(today(), 'Request a time change') : ''}
      ${manager() || last?.resume_pending ? `<div class="clock-tools">
        ${manager() ? actionButton('Office location', 'office-location', 'map-pin', 'secondary') + actionButton('Attendance settings', 'hr-settings', 'settings', 'secondary') : ''}
        ${last?.resume_pending ? actionButton('Cancel auto return', 'cancel-return', 'x', 'secondary') : ''}
      </div>` : ''}
    </div></section>`;
}

function locationCell(serialized) {
  if (!serialized) return '—';
  const place = JSON.parse(serialized);
  if (place.label) return e(place.label);
  const coords = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
  return `<a class="map-link" target="_blank" rel="noopener noreferrer" href="${e(openStreetMapUrl(place))}">${coords}</a>
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


function table(caption, columns, rows) {
  return `<div class="table-wrap" tabindex="0" aria-label="${caption}"><table><thead><tr>
    ${columns.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function calendarFeedStatus(employeeId) {
  const feed = state.calendarFeeds?.find((item) => item.employee_id === employeeId);
  if (!feed) return tag('No link', 'neutral');
  if (!feed.last_read_at) return tag('Link created', 'sand');
  return `<span>Feed accessed</span><small>${shortDate.format(feed.last_read_at)} · ${time(feed.last_read_at)} IST</small>`;
}

function teamPage() {
  const staff = state.employees.filter((person) => !person.is_admin);
  const rows = staff.map((person) => [
    `<div class="inline">${avatar(person)}<div><strong>${e(person.name)}</strong><small>${e(person.role)}</small></div></div>`,
    e(person.email),
    e(person.phone || '—'),
    person.has_login ? tag('Login set', 'sage') : tag('Credentials needed', 'sand'),
    ...(state.calendarFeeds ? [calendarFeedStatus(person.id)] : []),
    shiftFor(person.id) ? tag('Clocked in', 'sage') : tag('Clocked out', 'neutral'),
    state.tasks.filter((task) => assignedTo(task, person.id) && !task.completed_at && task.shoot_status === 'booked').length,
    actionButton('Edit employee', 'edit-employee', 'pencil', 'secondary', person.id),
  ]);
  return `${heading('Employees', 'Manage employee profiles and sign-in credentials.', actionButton('Add employee', 'new-employee', 'user-plus'))}
    <section class="panel">${rows.length ? table('Employee directory', ['Employee', 'Sign-in email', 'Mobile', 'Credentials', ...(state.calendarFeeds ? ['Calendar'] : []), 'Attendance', 'Open assignments', 'Actions'], rows) : empty('Add an employee to create their login and assign their first shoot.')}</section>`;
}

function schedulePage() {
  const now = Date.now();
  const filtered = state.tasks.filter((task) => {
    if (employeeFilter !== 'all' && !assignedTo(task, Number(employeeFilter))) return false;
    if (scheduleFilter === 'today') return day(task.start_at) === day(now);
    if (scheduleFilter === 'upcoming') return task.shoot_status === 'booked' && !task.completed_at && task.start_at + task.estimate * 60_000 > now;
    if (scheduleFilter === 'completed') return Boolean(task.completed_at);
    return true;
  });
  const options = [['upcoming', 'Upcoming'], ['today', 'Today'], ['all', 'All work'], ['completed', 'Completed']];
  const actions = `<div class="card-actions schedule-actions">
    ${viewLink('shoot-calendar', 'Shoot calendar')}
    ${apiOrigin ? actionButton('Connect calendar', 'calendar-open', 'calendar-plus', 'secondary') : ''}
    ${manager() ? actionButton('Schedule shoot', 'new-task', 'plus') : ''}
  </div>`;
  return `${heading(manager() ? 'Schedule' : 'My Schedule', manager() ? 'Review assignments, open shoots, and tracked work.' : 'Priority assignments are listed first. Times are in IST.', actions)}
    <div class="filter-bar">
      ${options.map(([key, label]) => `<button type="button" class="filter ${key === scheduleFilter ? 'active' : ''}" data-action="schedule-filter" data-value="${key}" aria-pressed="${key === scheduleFilter}">${label}</button>`).join('')}
      ${manager() ? `<select id="schedule-employee" aria-label="Filter schedule by employee"><option value="all">All employees</option>
        ${state.employees.map((person) => `<option value="${person.id}" ${String(person.id) === employeeFilter ? 'selected' : ''}>${e(person.name)}</option>`).join('')}</select>` : ''}
    </div>
    ${filtered.length ? `<div class="task-grid">${filtered.map((task) => taskCard(task)).join('')}</div>` : `<section class="panel">${empty('No work matches this view.')}</section>`}`;
}

function calendarDialog(info) {
  const button = info.enabled
    ? actionButton('Replace calendar link', 'calendar-issue', 'refresh-cw', 'secondary')
    : actionButton('Create private link', 'calendar-issue', 'link');
  const providerInstructions = info.url ? `
    <label class="calendar-link">Private calendar URL
      <input type="url" id="personal-calendar-url" value="${e(info.url)}" readonly spellcheck="false">
    </label>
    <div class="card-actions">
      ${actionButton('Copy link', 'calendar-copy', 'copy', 'secondary')}
      <a class="text-link" href="${e(info.url.replace(/^https:/, 'webcal:'))}" referrerpolicy="no-referrer">Open Apple Calendar</a>
    </div>
    <ul class="calendar-instructions">
      <li><strong>Google Calendar</strong> — In the web calendar, use <b>Other calendars → From URL</b>.</li>
      <li><strong>Outlook</strong> — Use <b>Add calendar → Subscribe from web</b>.</li>
      <li><strong>Apple Calendar</strong> — Open the link above or add it as a calendar subscription.</li>
    </ul>` : '';
  const status = info.enabled
    ? (info.lastReadAt ? `Last feed access ${shortDate.format(info.lastReadAt)}, ${time(info.lastReadAt)} IST.` : 'Private calendar link created.')
    : 'Create a link to subscribe to your assigned work.';
  openDialog('Connect calendar', `Use your calendar account for ${e(actor().email)}.`, `
    <div class="calendar-connect">
      <p>${status}</p>
      ${providerInstructions}
      ${info.url ? '<p>Keep the link private. Your calendar provider controls how often it refreshes.</p>' : ''}
      ${info.enabled && !info.url ? '<p>Use your saved link, or replace it to get a new one. Existing subscriptions stop when you replace or disable the link.</p>' : ''}
      <div class="card-actions">
        ${info.url ? '' : button}
        ${info.enabled ? actionButton('Disable link', 'calendar-revoke', 'link-2-off', 'secondary') : ''}
      </div>
    </div>
  `);
}

dialog.addEventListener('close', () => {
  if (!dialog.open && dialog.querySelector('.calendar-connect')) dialog.replaceChildren();
});

function workControls(task) {
  if (!assignedTo(task, actorId) || task.shoot_status !== 'booked') return '';
  if (task.blocked_reason) {
    return `<button type="button" class="btn secondary" data-action="task-timer" data-value="unblock" data-id="${task.id}">${icon('unlock')}Unblock task</button>`;
  }
  if (task.category === 'Photo shoot') {
    const shift = shiftFor(actorId);
    const atShoot = shift?.site && JSON.parse(shift.site).taskId === task.id;
    if (atShoot) {
      const complete = task.completed_at || task.crew?.length > 1 ? '' : '<button type="button" class="btn secondary" data-action="task-timer" data-value="complete" data-id="' + task.id + '">Mark complete</button>';
      return actionButton('Clock out of shoot', 'clock', 'log-out', 'primary', task.id) + complete;
    }
    if (task.completed_at) return '';
    if (!shootSite(task)) return '<p class="task-location-note">A shoot location needs to be set before check-in.</p>';
    if (!shift && checkInShoots().some((item) => item.id === task.id)) return actionButton('Clock in at shoot', 'clock', 'log-in', 'primary', task.id);
    return `<p class="task-location-note">${shift ? 'Clock out of your current site before starting this shoot.' :
      Date.now() < task.start_at - 30 * 60_000 ? 'Shoot check-in opens 30 minutes before the start.' : 'The shoot check-in window has ended.'}</p>`;
  }
  if (task.completed_at) return '';
  const active = activeSession(task);
  return `<button type="button" class="btn primary" data-action="task-timer" data-value="${active ? 'pause' : 'start'}" data-id="${task.id}">
    ${icon(active ? 'pause' : 'play')}${active ? 'Pause timer' : 'Start timer'}</button>
    <button type="button" class="btn secondary" data-action="task-timer" data-value="complete" data-id="${task.id}">Mark complete</button>
    ${actionButton('Block task', 'block-task', 'octagon-alert', 'secondary', task.id)}`;
}

function taskCard(task, inDialog = false) {
  const isShoot = task.category === 'Photo shoot';
  return `<article class="${inDialog ? '' : 'panel task-card'}">
    ${inDialog ? '' : `<div class="panel-head"><div><h2>${e(task.title)}</h2><p>${e(task.category)}</p></div>
      <div class="row-tags">${priority(task)}${taskStatus(task)}</div></div>`}
    <div class="task-details">
      ${task.crew?.length ? `<div class="inline">${icon('users')}${e(task.crew.map((member) => member.name).join(', '))}</div>` :
        manager() ? `<div class="inline">${icon('user-round')}${task.is_open ? 'Open to employee requests' : e(employee(task.employee_id)?.name)}</div>` : ''}
      <div class="inline">${icon('calendar-days')}${task.shoot_status === 'postponed' ? 'Awaiting a new date' :
        `${shortDate.format(task.start_at)} · ${time(task.start_at)}${isShoot ? ` – ${shootEndLabel(task)}` : ''} IST`}</div>
      <div class="inline">${icon('map-pin')}${e(task.location)} ${mapLinks(shootSite(task))}</div>
      ${task.client_name ? `<div class="inline">${icon('contact-round')}${e(task.client_name)} · <a class="map-link" href="tel:${e(task.client_phone)}">${e(task.client_phone)}</a></div>` : ''}
      ${manager() && isShoot ? `<div class="inline">${icon('indian-rupee')}${money(task.income_paise)} expected income</div>` : ''}
    </div>
    ${task.blocked_reason ? `<p class="hr-task-note"><strong>Blocked</strong><br>${e(task.blocked_reason)}</p>` : ''}
    <div class="task-times">
      <div><small>Scheduled duration</small><strong>${duration(task.estimate * 60_000)}</strong></div>
      <div><small>${manager() && task.crew?.length > 1 ? 'Crew time tracked' : 'Time tracked'}</small><strong ${activeSession(task) ? `data-elapsed="${task.id}"` : ''}>${elapsed(task)}</strong></div>
    </div>
    <div class="card-actions">${workControls(task)}
      ${manager() && (isShoot || !task.completed_at) ? actionButton('Edit schedule', 'edit-task', 'pencil', 'secondary', task.id) : ''}
      ${manager() && isShoot && !task.completed_at && !task.is_open && task.shoot_status === 'booked'
        ? actionButton('Mark shoot done', 'shoot-done', 'circle-check', 'secondary', task.id) : ''}
    </div>
  </article>`;
}

function clientsPage() {
  const rows = state.clients.map((client) => [
    `<strong>${e(client.name)}</strong>`, `<a class="map-link" href="tel:${e(client.phone)}">${e(client.phone)}</a>`,
    e(client.email || '—'), e(client.notes || '—'),
    shoots().filter((task) => task.client_id === client.id).length,
    actionButton('Edit client', 'edit-client', 'pencil', 'secondary', client.id),
  ]);
  return `${heading('Clients', 'Find the owners, contacts, and notes for your shoots.', actionButton('Add client', 'new-client', 'user-plus'))}
    <section class="panel">${rows.length ? table('Clients', ['Client', 'Mobile', 'Email', 'Notes', 'Shoots', 'Actions'], rows) : empty('Add a client here or enter their details when scheduling a shoot.')}</section>`;
}

function requestStatus(request) {
  const colorsByStatus = { pending: 'sand', approved: 'sage', declined: 'neutral' };
  return tag(request.status[0].toUpperCase() + request.status.slice(1), colorsByStatus[request.status]);
}

function approvalsPage() {
  const rows = state.requests.map((item) => [
    `<strong>${e(item.title)}</strong>`, e(employee(item.employee_id)?.name),
    e(item.note || '—'), shortDate.format(item.requested_at), requestStatus(item),
    item.status === 'pending' ? `<div class="card-actions">${actionButton('Approve', 'approve-request', 'check', 'primary', item.id)}
      ${actionButton('Decline', 'decline-request', 'x', 'secondary', item.id)}</div>` : '—',
  ]);
  return `${heading('Approvals', 'Review work, leave, and attendance requests from employees.')}
    <section class="panel"><div class="panel-head"><h2>Work requests</h2></div>
      ${rows.length ? table('Work requests', ['Work', 'Employee', 'Request note', 'Requested', 'Status', 'Actions'], rows) : empty('Employee requests for open work will appear here.')}</section>
    ${hrViews.approvals()}`;
}

function availableWorkPage() {
  return `${heading('Available Work', 'Request a shoot to add it to your schedule after admin approval.')}
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Open opportunities</h2></div></div>
      ${state.openWork.length ? state.openWork.map((task) => {
        const previous = state.requests.find((item) => item.task_id === task.id);
        return `<div class="notice-row"><div><h3>${e(task.title)}</h3><p>${shortDate.format(task.start_at)} · ${time(task.start_at)} IST</p></div>
          <div class="row-end">${previous ? requestStatus(previous) : actionButton('Request work', 'request-work', 'hand', 'secondary', task.id)}</div></div>`;
      }).join('') : empty('There is no open work right now.')}
    </section><section class="panel"><div class="panel-head"><div><h2>My requests</h2></div></div>
      ${state.requests.length ? state.requests.map((item) => `<div class="notice-row"><div><h3>${e(item.title)}</h3><p>${shortDate.format(item.requested_at)}</p></div>${requestStatus(item)}</div>`).join('')
      : empty('You have not requested any work yet.')}</section></div>`;
}

function paidFor(taskId) {
  return state.payments.filter((payment) => payment.task_id === taskId).reduce((sum, payment) => sum + payment.amount_paise, 0);
}

function financesPage() {
  const totalsToDate = totals();
  const rows = shoots().map((task) => {
    const paid = paidFor(task.id);
    const cancelled = task.shoot_status === 'cancelled';
    const due = cancelled ? 0 : task.income_paise - paid;
    return [`<strong>${e(task.title)}</strong><small>${e(task.client_name || 'No client')}</small>`,
      money(cancelled ? paid : task.income_paise), money(paid), money(due),
      cancelled ? tag('Cancelled', 'neutral') : due > 0 ? actionButton('Record payment', 'record-payment', 'plus', 'secondary', task.id) : tag('Settled', 'sage')];
  });
  const paymentRows = state.payments.map((entry) => [e(entry.paid_on),
    e(state.tasks.find((task) => task.id === entry.task_id)?.title), money(entry.amount_paise), e(entry.note || '—'),
    actionButton('Edit payment', 'edit-payment', 'pencil', 'secondary', entry.id)]);
  const expenseRows = state.expenses.map((entry) => [e(entry.spent_on), e(entry.name), e(entry.category), money(entry.amount_paise), e(entry.note || '—'),
    actionButton('Edit expense', 'edit-expense', 'pencil', 'secondary', entry.id)]);
  return `${heading('Finances', 'Track shoot income, payments, and studio expenses in INR.', actionButton('Add expense', 'add-expense', 'plus'))}
    ${metrics([['Expected shoot income', money(totalsToDate.income), 'indian-rupee', 'lavender'],
      ['Payments received', money(totalsToDate.received), 'wallet', 'sage'], ['Payments pending', money(totalsToDate.outstanding), 'hourglass', 'sand'],
      ['Expenses to date', money(totalsToDate.expenses), 'receipt', 'peach']])}
    <section class="panel net-panel"><div><h2>Cash profit to date</h2><p>Payments received less expenses recorded</p></div><strong>${money(totalsToDate.net)}</strong></section>
    <section class="panel finance-table"><div class="panel-head"><div><h2>Shoot balances</h2><p>Record full or partial payments against each shoot.</p></div></div>
      ${rows.length ? table('Shoot balances', ['Shoot', 'Expected', 'Received', 'Pending', 'Actions'], rows) : empty('Add a shoot with its expected income to track a balance.')}</section>
    <div class="dashboard-grid ledger-panels">
      <section class="panel"><div class="panel-head"><div><h2>Payment history</h2></div></div>
        ${paymentRows.length ? table('Payments', ['Date', 'Shoot', 'Amount', 'Reference', 'Actions'], paymentRows) : empty('No payments recorded.')}</section>
      <section class="panel"><div class="panel-head"><div><h2>Expense history</h2></div></div>
        ${expenseRows.length ? table('Expenses', ['Date', 'Expense', 'Category', 'Amount', 'Notes', 'Actions'], expenseRows) : empty('No expenses recorded.')}</section>
    </div>`;
}

function mobileAlertControls() {
  if (!apiOrigin) return { description: 'Mobile alerts are available on the hosted workspace.' };
  if (needsHomeScreen()) return {
    description: 'On iPhone or iPad, use Safari’s Share menu to add this site to your Home Screen. Open the installed app and enable mobile alerts.',
  };
  if (!supportsMobileAlerts()) return { description: 'Mobile alerts are unavailable in this browser.' };
  if (mobileDevice?.error) return {
    description: 'Could not check this device’s notification settings.',
    action: actionButton('Retry mobile alerts', 'retry-alerts', 'refresh-cw', 'secondary'),
  };
  if (!mobileDevice?.registration) return { description: 'Checking mobile alert settings…' };
  if (mobileDevice.enabled) return {
    description: 'Mobile alerts are on for this device. You can close the workspace and still receive reminders.',
    action: actionButton('Disable mobile alerts', 'disable-alerts', 'bell-off', 'secondary'),
  };
  return {
    description: 'Enable alerts on this device to receive work reminders 30 minutes before the scheduled start.',
    action: actionButton('Enable mobile alerts', 'enable-alerts', 'bell', 'secondary'),
  };
}

async function prepareMobileAlerts() {
  if (!apiOrigin || mobileDevice || needsHomeScreen() || !supportsMobileAlerts()) return;
  const device = {};
  mobileDevice = device;
  try {
    const [registration, key] = await Promise.all([preparePushWorker(), request('push/key')]);
    const subscription = await registration.pushManager.getSubscription();
    const status = subscription ? await request('push/status', { endpoint: subscription.endpoint }) : { enabled: false };
    Object.assign(device, { registration, key: key.publicKey, enabled: status.enabled });
  } catch {
    device.error = true;
  }
  if (mobileDevice === device && page === 'notifications' && actor()) render();
}

function notificationsPage() {
  const notices = reminders();
  const mobile = mobileAlertControls();
  return `${heading('Notifications', 'Reminders for your assigned work.', mobile.action)}
    <section class="panel">
      <div class="panel-head"><div><h2>${actor() ? `Reminders for ${e(actor().name)}` : 'Work reminders'}</h2><p>${mobile.description}</p></div>
      ${notices.some((notice) => !notice.read_at) ? actionButton('Mark all read', 'read', 'check-check', 'secondary') : ''}</div>
      ${notices.length ? notices.map((notice) => `<div class="notice-row">
        ${tile('bell', 'peach')}<div><h3>${e(notice.title)}</h3>
        <p>Scheduled for ${shortDate.format(notice.start_at)} at ${time(notice.start_at)} IST</p></div>${notice.read_at ? '' : tag('Unread', 'peach')}
      </div>`).join('') : empty('No reminders yet.')}
    </section>`;
}


const hrViews = createHrViews({
  actor, state: () => state, manager, e, icon, tag, heading, viewLink, empty, actionButton, time, timeInput: studioTimeInput,
  day, today, money, duration, employee, table, clockCard, attendanceTable, sessionsFor, activeSession, entryForm, openDialog, applyAction, render, shootEndLabel,
});

const pages = {
  dashboard, team: teamPage, schedule: schedulePage, 'shoot-calendar': hrViews.shootCalendar,
  'task-board': hrViews.taskBoard, 'work-log': hrViews.workLog, leave: hrViews.leave, payroll: hrViews.payroll,
  announcements: hrViews.announcements, clients: clientsPage, approvals: approvalsPage,
  work: availableWorkPage, finances: financesPage, attendance: hrViews.attendance, notifications: notificationsPage,
};

function render() {
  if (!actor()) return;
  document.body.classList.remove('signed-out');
  displayedDate = today();
  shownShootIds = shootIds();
  renderChrome();
  main.innerHTML = pages[page]();
  if (page === 'notifications') prepareMobileAlerts();
  if (dialog.open && dialog.dataset.taskId) {
    const task = state.tasks.find((item) => item.id === Number(dialog.dataset.taskId));
    if (task) taskDialog(task);
    else dialog.close();
  }
  updateTracking();
  tick();
}

function tick() {
  if (!actor()) return;
  if (displayedDate !== today() || shownShootIds !== shootIds()) {
    render();
    return;
  }
  processLocation();
  const hours = document.querySelector('#today-hours');
  if (hours) hours.textContent = hrViews.todayClock();
  document.querySelectorAll('[data-elapsed]').forEach((element) => {
    const task = state.tasks.find((item) => item.id === Number(element.dataset.elapsed));
    if (task) element.textContent = elapsed(task);
  });
}

function storeSessionToken(token) {
  if (!sessionKey) return;
  accessToken = token;
  if (token) sessionStorage.setItem(sessionKey, token);
  else sessionStorage.removeItem(sessionKey);
}

async function request(path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response;
  let payload;
  try {
    response = await fetch(`${apiOrigin || ''}/api/${path}`, {
      headers,
      ...(path === 'session' ? { signal: AbortSignal.timeout(12000) } : {}),
      ...(apiOrigin ? { credentials: 'omit' } : {}),
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    payload = await response.json();
  } catch {
    throw new Error('The studio workspace could not be reached. Try again.');
  }
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') {
      storeSessionToken(null);
      if (session?.actor) clearWorkspace({ actor: null });
    }
    throw new Error(payload?.error || 'The workspace could not complete the request. Try again.');
  }
  if (path === 'login') storeSessionToken(payload.token);
  if (path === 'logout') storeSessionToken(null);
  return payload;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function notifyReminders(items) {
  if (!items.length) return;
  showToast(`Upcoming work: ${items.map((notice) => notice.title).join(', ')}`);
}

function clearWorkspace(info) {
  sessionVersion++;
  refreshVersion++;
  loading = false;
  snapshot = undefined;
  state = initialState();
  actorId = undefined;
  mobileDevice = undefined;
  session = info;
  clockTarget = '';
  employeeFilter = 'all';
  scheduleFilter = 'upcoming';
  hrViews.reset();
  mobileMenu = false;
  if (dialog.open) dialog.close();
  clearTimeout(toastTimer);
  toast.hidden = true;
  stopTracking();
  loginPage();
}

async function refresh({ force = false } = {}) {
  if (!session?.actor || (loading && !force)) return;
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
    state = { ...initialState(), ...fresh };
    actorId = fresh.actor.id;
    page = currentPage();
    render();
    if (!first) notifyReminders(reminders().filter((notice) => !notice.read_at && !oldIds.has(notice.task_id)));
  } finally {
    if (version === refreshVersion) loading = false;
  }
}

async function loadSession() {
  const version = ++sessionVersion;
  try {
    const info = await request('session');
    if (version !== sessionVersion) return;
    session = info;
    showAuthStatus();
    if (info.actor) {
      await refresh({ force: true });
      return;
    }
    storeSessionToken(null);
    if (actor()) clearWorkspace(info);
  } catch {
    if (version === sessionVersion) {
      showAuthStatus('The studio could not connect to its workspace. Retry the connection or ask your studio admin to check the deployment.');
    }
  }
}

function openDialog(title, subtitle, body) {
  delete dialog.dataset.taskId;
  dialog.innerHTML = `<div class="dialog-inner"><div class="panel-head">
    <div><h2 id="dialog-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
    <button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('x')}</button>
  </div>${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function entryForm(kind, fields, label) {
  return `<form data-form="${kind}"><div class="form-grid">${fields}</div><p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="btn secondary" data-action="close">Cancel</button><button class="btn primary" type="submit">${label}</button></div>
  </form>`;
}


function employeeForm(person) {
  const needsPassword = !person?.has_login;
  openDialog(person ? 'Edit employee' : 'Add employee',
    'The employee signs in with this email and the password you set.', entryForm('employees', `
    ${person ? `<input type="hidden" name="id" value="${person.id}">` : ''}
    <label class="full">Full name<input name="name" autocomplete="off" required maxlength="100" value="${e(person?.name)}"></label>
    <label>Job role<input name="role" required maxlength="100" value="${e(person?.role)}"></label>
    <label>Mobile number<input name="phone" type="tel" maxlength="30" value="${e(person?.phone)}"></label>
    <label class="full">Employment start date<input name="employmentStart" type="date" value="${e(person?.employment_start)}"></label>
    <label class="full">Sign-in email<input name="email" type="email" autocomplete="off" required maxlength="254" value="${e(person?.email)}"></label>
    ${passwordField({
      id: 'employee-password',
      label: needsPassword ? 'Password' : 'New password (optional)',
      newPassword: true,
      required: needsPassword,
    })}
    ${!needsPassword ? '<p class="field-note full">A new password signs the employee out of their current sessions.</p>' : ''}
  `, 'Save employee'));
}

function clientForm(client) {
  openDialog(client ? 'Edit client' : 'Add client', '', entryForm('clients', `
    ${client ? `<input type="hidden" name="id" value="${client.id}">` : ''}
    <label class="full">Client name<input name="name" required maxlength="100" value="${e(client?.name)}"></label>
    <label>Mobile number<input name="phone" type="tel" required maxlength="30" value="${e(client?.phone)}"></label>
    <label>Email address<input name="email" type="email" maxlength="254" value="${e(client?.email)}"></label>
    <label class="full">Notes<textarea name="notes" maxlength="1000" rows="3">${e(client?.notes)}</textarea></label>
  `, 'Save client'));
}

function mapFields(site = {}) {
  return `<label class="full">Google Maps link<input name="mapsUrl" type="url" maxlength="2048" required placeholder="https://maps.app.goo.gl/…" value="${e(site.maps_url)}"></label>
    <details class="full coordinates">
      <summary>Enter pin coordinates if the link can’t be resolved</summary>
      <div class="form-grid">
        <label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" value="${e(site.latitude)}"></label>
        <label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" value="${e(site.longitude)}"></label>
      </div>
    </details>`;
}

function locationForm() {
  const office = state.office;
  openDialog('Company location', 'Paste the Google Maps link for the office attendance boundary.', entryForm('office', `
    <label class="full">Location name<input name="name" required maxlength="100" value="${e(office?.name || 'Concept Photography')}"></label>
    ${mapFields(office ?? {})}
  `, 'Save location'));
}

function taskForm(task, type = 'all') {
  const isBoard = type === 'board';
  const self = !manager();
  const category = task?.category || (isBoard ? 'Editing' : 'Photo shoot');
  const isShoot = category === 'Photo shoot';
  const completed = isShoot && Boolean(task?.completed_at);
  const isOpen = Boolean(task?.is_open);
  const employees = state.employees.filter((person) => person.has_login || person.is_admin);
  const staff = employees.filter((person) => !person.is_admin);
  const selected = (isOpen ? null : task?.employee_id) ?? staff[0]?.id ?? actorId;
  const clientId = task?.client_id;
  openDialog(task ? 'Edit schedule' : isBoard ? (self ? 'Add task' : 'Assign task') : 'Schedule shoot',
    completed ? 'Update the completed shoot’s details and scheduled times.' : self ? 'This task will appear on your board.' :
      'Direct assignments are marked as priority on the employee’s schedule.', entryForm('tasks', `
    ${task ? `<input type="hidden" name="id" value="${task.id}"><input type="hidden" name="category" value="${e(category)}">` : ''}
    <label class="full">Shoot or task name<input name="title" required maxlength="100" value="${e(task?.title)}"></label>
    ${!task ? type === 'shoot' ? '<input type="hidden" name="category" value="Photo shoot">' :
      `<label>Work type<select name="category">${Object.keys(categories).filter((name) => !isBoard || name !== 'Photo shoot').map((name) => `<option>${name}</option>`).join('')}</select></label>` : ''}
    ${self ? '' : completed ? `<input type="hidden" name="employeeId" value="${task.employee_id}">` :
      `<label>Assignment<select name="assignment"><option value="assigned">Assign directly</option><option value="open" ${isOpen ? 'selected' : ''}>Open for employee requests</option></select></label>
    <label class="full assignee" ${isOpen ? 'hidden' : ''}>Assigned employee or shoot lead<select name="employeeId" required ${isOpen ? 'disabled' : ''}>
      ${[...staff, ...employees.filter((person) => person.is_admin)].map((person) => `<option value="${person.id}" ${person.id === selected ? 'selected' : ''}>${e(person.name)}</option>`).join('')}</select></label>`}
    <fieldset class="full shoot-time-fields" ${isShoot ? '' : 'hidden disabled'}><legend>Shoot time</legend>
      <div class="form-grid">
        <label>From (IST)<input name="shootFrom" type="datetime-local" required value="${task ? studioDateTimeInput(task.start_at) : ''}"></label>
        <label>To (IST)<input name="shootTo" type="datetime-local" required value="${task ? studioDateTimeInput(task.start_at + task.estimate * 60_000) : ''}" aria-describedby="shoot-time-help"></label>
      </div>
      <p class="field-note" id="shoot-time-help">Shoots can end the next day and run for up to 24 hours.</p>
    </fieldset>
    <fieldset class="full task-time-fields" ${isShoot ? 'hidden disabled' : ''}>
      <label>Scheduled date<input name="startDate" type="date" required value="${task ? day(task.start_at) : today()}"></label>
      <label>Scheduled time (IST)<input name="startTime" type="time" required value="${task ? studioTimeInput.format(task.start_at) : ''}"></label>
      <label>Duration in minutes<input name="estimate" type="number" required min="1" max="1440" value="${task?.estimate ?? 60}"></label>
    </fieldset>
    <label>Location name<input name="location" required maxlength="100" value="${e(task?.location)}"></label>
    <fieldset class="full shoot-fields" ${isShoot ? '' : 'hidden disabled'}><legend>Shoot and client details</legend>
      <div class="form-grid">
        ${completed ? '' : `<label class="full">Booking status<select name="shootStatus">${['booked', 'postponed', 'cancelled'].map((item) =>
          `<option value="${item}" ${item === task?.shoot_status ? 'selected' : ''}>${item[0].toUpperCase() + item.slice(1)}${item === 'postponed' ? ' · date to be confirmed' : ''}</option>`).join('')}</select></label>`}
        ${!self && !completed && employees.length > 1 ? `<fieldset class="full crew-fields" ${isOpen ? 'hidden disabled' : ''}><legend>Additional shoot crew</legend>
          <div class="hr-crew-options">${employees.filter((person) => person.id !== selected).map((person) =>
            `<label><input type="checkbox" name="crew" value="${person.id}"
              ${task?.crew?.some((member) => member.employee_id === person.id) ? 'checked' : ''}>${e(person.name)}</label>`).join('')}
            <label hidden><input type="checkbox" name="crew" value="${selected}" disabled>${e(employee(selected)?.name)}</label>
          </div></fieldset>` : ''}
        <label class="full">Client<select name="clientId"><option value="">Enter owner details</option>
          ${state.clients.map((client) => `<option value="${client.id}" ${client.id === clientId ? 'selected' : ''}>${e(client.name)} · ${e(client.phone)}</option>`).join('')}</select></label>
        <fieldset class="full owner-fields" ${clientId ? 'hidden disabled' : ''}>
          <label>Shoot owner name<input name="clientName" required maxlength="100" value="${e(task?.client_name)}"></label>
          <label>Owner mobile number<input name="clientPhone" type="tel" required maxlength="30" value="${e(task?.client_phone)}"></label>
        </fieldset>
        ${mapFields({ maps_url: task?.maps_url, latitude: task?.site_latitude, longitude: task?.site_longitude })}
        <label class="full">Expected shoot income (₹)<input name="income" type="number" required min="0" max="999999999.99" step="0.01" value="${task ? task.income_paise / 100 : ''}"></label>
      </div>
    </fieldset>
  `, 'Save schedule'));
}

function taskDialog(task) {
  openDialog(e(task.title), e(task.category) + (task.category === 'Photo shoot' && task.completed_at ? ' · Done' : ''), taskCard(task, true));
  dialog.dataset.taskId = task.id;
}

function requestForm(task) {
  openDialog('Request work', e(task.title), entryForm('work-requests', `
    <input type="hidden" name="taskId" value="${task.id}">
    <label class="full">Note to admin (optional)<textarea name="note" maxlength="500" rows="3"></textarea></label>
  `, 'Send request'));
}

function paymentForm(task, payment) {
  const available = task.income_paise - paidFor(task.id) + (payment?.amount_paise ?? 0);
  openDialog(payment ? 'Edit payment' : 'Record payment', `${e(task.title)} · ${money(available)} available to record`, entryForm('payments', `
    <input type="hidden" name="taskId" value="${task.id}">
    ${payment ? `<input type="hidden" name="id" value="${payment.id}">` : ''}
    <label>Amount received (₹)<input name="amount" type="number" min="0.01" max="${available / 100}" step="0.01" value="${payment ? payment.amount_paise / 100 : ''}" required></label>
    <label>Date received<input name="date" type="date" max="${today()}" value="${payment?.paid_on || today()}" required></label>
    <label class="full">Reference or note (optional)<input name="note" maxlength="300" value="${e(payment?.note)}"></label>
  `, payment ? 'Save payment' : 'Record payment'));
}

function expenseForm(expense) {
  openDialog(expense ? 'Edit expense' : 'Add expense', '', entryForm('expenses', `
    ${expense ? `<input type="hidden" name="id" value="${expense.id}">` : ''}
    <label class="full">Expense name<input name="name" maxlength="100" value="${e(expense?.name)}" required></label>
    <label>Category<input name="category" maxlength="100" required placeholder="Equipment, travel, or supplies" value="${e(expense?.category)}"></label>
    <label>Amount (₹)<input name="amount" type="number" min="0.01" step="0.01" value="${expense ? expense.amount_paise / 100 : ''}" required></label>
    <label>Date spent<input name="date" type="date" max="${today()}" value="${expense?.spent_on || today()}" required></label>
    <label class="full">Notes (optional)<textarea name="note" maxlength="300" rows="2">${e(expense?.note)}</textarea></label>
  `, 'Save expense'));
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
    : returnSite(latest, state.office, state.tasks.filter((task) => !task.is_open), actorId, Date.now());
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
    if (actor()) render();
  };
  permission.addEventListener('change', syncPermission);
  syncPermission();
}).catch(() => {});

async function mutate(button, callback) {
  if (pending) return;
  pending = true;
  const controls = button.closest('dialog, .card-actions, .hr-clock-buttons')?.querySelectorAll('button:not(:disabled)') ?? [button];
  controls.forEach((control) => { control.disabled = true; });
  try {
    await callback();
  } catch (error) {
    showToast(error.message);
  } finally {
    pending = false;
    controls.forEach((control) => { control.disabled = false; });
    updateTracking();
  }
}

const savedMessages = {
  employees: 'Employee saved.', clients: 'Client saved.', tasks: 'Schedule saved.', office: 'Company location saved.',
  'work-requests': 'Request sent.', 'hr/requests': 'Request sent.', 'hr/settings': 'Settings saved.',
  'hr/holidays': 'Holiday saved.', 'hr/payslips': 'Payslip saved.', 'hr/announcements': 'Announcement saved.',
  'hr/work-logs': 'Work logged.', 'task-action': 'Task blocked.', payments: 'Payment recorded.', expenses: 'Expense saved.',
};

function clockAction(button, taskId) {
  const employeeId = actorId;
  const shift = shiftFor(employeeId);
  const action = shift ? 'out' : 'in';
  mutate(button, async () => {
    const label = button.lastChild.textContent;
    button.lastChild.textContent = 'Getting location…';
    try {
      const location = await getLocation();
      if (actorId !== employeeId) throw new Error('Sign in again to record attendance.');
      await request('attendance', { action, location, taskId, shiftId: shift?.id });
      await refresh({ force: true });
      showToast(`Clocked ${action}. Time and location recorded.`);
    } finally {
      button.lastChild.textContent = label;
    }
  });
}

function applyAction(button, path, body, message, close = false) {
  mutate(button, async () => {
    await request(path, body);
    await refresh({ force: true });
    if (close && dialog.open) dialog.close();
    if (message) showToast(message);
  });
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-password-toggle]');
  if (toggle) {
    const field = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!(field instanceof HTMLInputElement)) return;
    const visible = field.type === 'password';
    field.type = visible ? 'text' : 'password';
    const label = visible ? 'Hide password' : 'Show password';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.innerHTML = icon(visible ? 'eye-off' : 'eye');
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (!button || !actor()) return;
  const { action, value } = button.dataset;
  const id = Number(button.dataset.id);
  const task = () => state.tasks.find((item) => item.id === id);
  if (Object.hasOwn(hrViews.actions, action)) {
    hrViews.actions[action](button, value, id);
    return;
  }
  switch (action) {
    case 'menu':
      mobileMenu = !mobileMenu;
      sidebar.classList.toggle('open', mobileMenu);
      button.setAttribute('aria-expanded', String(mobileMenu));
      break;
    case 'sign-out':
      mutate(button, async () => {
        const subscription = apiOrigin ? await currentPushSubscription() : null;
        await request('logout', { pushEndpoint: subscription?.endpoint });
        if (subscription) await subscription.unsubscribe().catch(() => {});
        history.replaceState(null, '', location.pathname);
        clearWorkspace({ actor: null });
      });
      break;
    case 'close': dialog.close(); break;
    case 'details': taskDialog(task()); break;
    case 'new-employee': employeeForm(); break;
    case 'edit-employee': employeeForm(employee(id)); break;
    case 'new-client': clientForm(); break;
    case 'edit-client': clientForm(state.clients.find((client) => client.id === id)); break;
    case 'new-task': taskForm(); break;
    case 'new-shoot': taskForm(null, 'shoot'); break;
    case 'new-board-task': taskForm(null, 'board'); break;
    case 'shoot-done': applyAction(button, 'shoot-done', { taskId: id }, 'Shoot marked done.'); break;
    case 'calendar-open':
      mutate(button, async () => calendarDialog(await request('calendar')));
      break;
    case 'calendar-issue':
      mutate(button, async () => {
        calendarDialog(await request('calendar/issue', {}));
        await refresh({ force: true });
      });
      break;
    case 'calendar-copy':
      mutate(button, async () => {
        const field = document.querySelector('#personal-calendar-url');
        try {
          await navigator.clipboard.writeText(field.value);
          showToast('Calendar link copied.');
        } catch {
          field.focus();
          field.select();
        }
      });
      break;
    case 'calendar-revoke':
      mutate(button, async () => {
        calendarDialog(await request('calendar/revoke', {}));
        await refresh({ force: true });
        showToast('Calendar link disabled.');
      });
      break;
    case 'edit-task': taskForm(task()); break;
    case 'office-location': locationForm(); break;
    case 'request-work': requestForm(state.openWork.find((item) => item.id === id)); break;
    case 'record-payment': paymentForm(task()); break;
    case 'edit-payment': {
      const payment = state.payments.find((item) => item.id === id);
      const shoot = state.tasks.find((item) => item.id === payment?.task_id);
      if (shoot) paymentForm(shoot, payment);
      break;
    }
    case 'add-expense': expenseForm(); break;
    case 'edit-expense': expenseForm(state.expenses.find((item) => item.id === id)); break;
    case 'approve-request':
    case 'decline-request': {
      const status = action === 'approve-request' ? 'approved' : 'declined';
      applyAction(button, 'request-decisions', { id, status }, `Request ${status}.`);
      break;
    }
    case 'schedule-filter':
      scheduleFilter = value;
      render();
      main.querySelector('[data-action="schedule-filter"][aria-pressed="true"]')?.focus();
      break;
    case 'clock': clockAction(button, id || Number(clockTarget) || null); break;
    case 'task-timer':
      applyAction(button, 'task-action', { taskId: id, action: value },
        { start: 'Timer started.', pause: 'Timer paused.', complete: 'Work marked complete.', unblock: 'Task unblocked.' }[value]);
      break;
    case 'enable-location':
      mutate(button, async () => { await getLocation(); render(); });
      break;
    case 'cancel-return':
      applyAction(button, 'attendance', { shiftId: latestShift()?.id, action: 'cancel-return' }, 'Automatic return cancelled.');
      break;
    case 'read': applyAction(button, 'reminders/read', {}); break;
    case 'retry-alerts':
      mobileDevice = undefined;
      render();
      break;
    case 'enable-alerts':
      mutate(button, async () => {
        const device = mobileDevice;
        const subscription = await subscribeToMobileAlerts(device.registration, device.key);
        await request('push/register', subscription.toJSON());
        device.enabled = true;
        render();
        showToast('Mobile alerts enabled on this device.');
      });
      break;
    case 'disable-alerts':
      mutate(button, async () => {
        const subscription = await currentPushSubscription();
        if (subscription) {
          await request('push/remove', { endpoint: subscription.endpoint });
          await subscription.unsubscribe().catch(() => {});
        }
        mobileDevice.enabled = false;
        render();
        showToast('Mobile alerts disabled on this device.');
      });
      break;
  }
});

function toggleFields(element, shown) {
  element.hidden = !shown;
  element.disabled = !shown;
}

document.addEventListener('change', (event) => {
  const input = event.target;
  if (Object.hasOwn(hrViews.filters, input.id)) {
    hrViews.filters[input.id](input.value);
    render();
    document.getElementById(input.id)?.focus();
    return;
  }
  if (input.id === 'clock-target') clockTarget = input.value;
  if (input.id === 'schedule-employee') {
    employeeFilter = input.value;
    render();
    main.querySelector('#schedule-employee')?.focus();
  }
  const form = input.form;
  if (form?.dataset.form !== 'tasks') return;
  if (input.name === 'category') {
    const shoot = input.value === 'Photo shoot';
    toggleFields(form.querySelector('.shoot-fields'), shoot);
    toggleFields(form.querySelector('.shoot-time-fields'), shoot);
    toggleFields(form.querySelector('.task-time-fields'), !shoot);
  }
  if (input.name === 'shootFrom' && input.value && !form.elements.shootTo.value) {
    form.elements.shootTo.value = studioDateTimeInput(Date.parse(`${input.value}:00+05:30`) + 60 * 60_000);
  }
  if (input.name === 'clientId') toggleFields(form.querySelector('.owner-fields'), !input.value);
  if (input.name === 'assignment') {
    const direct = input.value !== 'open';
    form.querySelector('.assignee').hidden = !direct;
    form.elements.employeeId.disabled = !direct;
    if (form.querySelector('.crew-fields')) toggleFields(form.querySelector('.crew-fields'), direct);
  }
  if (input.name === 'employeeId') {
    form.querySelectorAll('input[name="crew"]').forEach((option) => {
      option.disabled = option.value === input.value;
      option.closest('label').hidden = option.disabled;
      if (option.disabled) option.checked = false;
    });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.name !== 'mapsUrl') return;
  const { latitude, longitude } = event.target.form.elements;
  latitude.value = '';
  longitude.value = '';
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  if (pending) return;
  const errorNote = form.querySelector('.form-error');
  errorNote.hidden = true;
  const fields = new FormData(form);
  const data = Object.fromEntries(fields);
  if (kind === 'tasks') {
    if (data.category === 'Photo shoot') {
      data.startAt = `${data.shootFrom}:00+05:30`;
      data.endAt = `${data.shootTo}:00+05:30`;
      if (form.querySelector('.crew-fields')) data.crew = fields.getAll('crew');
    } else {
      data.startAt = `${data.startDate}T${data.startTime}:00+05:30`;
    }
  }
  const authLabel = form.querySelector('.auth-submit span');
  const originalLabel = authLabel?.textContent;
  mutate(event.submitter, async () => {
    if (authLabel) {
      sessionVersion++;
      form.setAttribute('aria-busy', 'true');
      authLabel.textContent = 'Signing in…';
    }
    try {
      await request(kind, data);
      if (kind === 'login') {
        history.replaceState(null, '', '#dashboard');
        await loadSession();
        return;
      }
      await refresh({ force: true });
      if (dialog.open) dialog.close();
      if (kind === 'tasks' && !['schedule', 'shoot-calendar', 'task-board'].includes(page)) {
        location.hash = data.category === 'Photo shoot' ? '#shoot-calendar' : '#task-board';
      }
      showToast(savedMessages[kind]);
    } catch (error) {
      errorNote.textContent = error.message;
      errorNote.hidden = false;
    } finally {
      if (authLabel) {
        authLabel.textContent = originalLabel;
        form.removeAttribute('aria-busy');
      }
    }
  });
});

window.addEventListener('hashchange', () => {
  if (!actor() || location.hash === '#main') return;
  page = currentPage();
  mobileMenu = false;
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
});

loadSession();
setInterval(tick, 1000);
setInterval(() => {
  if (!pending && session?.actor) refresh().catch(() => {});
}, 15000);
