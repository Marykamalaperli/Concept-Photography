import {
  additionalShootLocations, assignedTo, availableShoots, fenceRadius, maxAdditionalShootSites, maxFixAge, presenceAt, returnSite, shootSites,
} from './attendance-policy.js';
import { loginView, passwordField, togglePassword, workspaceRequest } from './access-view.js';
import { financeCsv, financeReport } from './finance-report.js';
import {
  currentPushSubscription, needsHomeScreen, preparePushWorker, subscribeToMobileAlerts, supportsMobileAlerts,
} from './mobile-alerts.js';

const webPushEnabled = Boolean(document.querySelector('meta[name="concept-web-push"]'));

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
  hrSettings: { monthly_leave: 2, week_off: 0, required_minutes: 480, verification_grace_minutes: 5 },
  holidays: [], hrRequests: [], workLogs: [], payslips: [], announcements: [], attendanceGaps: [],
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
let initialLoadError = false;
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
let checkedSite = '';
let locationCheck = '';
let financeMonth = '';

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
    <nav class="nav" aria-label="Workspace">
      ${nav().map(([key, label, symbol]) => {
        const count = key === 'approvals' ? pendingRequests().length : key === 'notifications' ? unread : 0;
        return `<a href="#${key}" class="nav-link ${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>
          ${icon(symbol)}${label}${count ? `<span class="nav-count">${count}</span>` : ''}
        </a>`;
      }).join('')}
    </nav>
    <div class="sidebar-foot"><img src="./brand-mark.png" width="18" height="18" alt=""><strong>Concept Photography</strong></div>`;
  topbar.innerHTML = `
    <div class="breadcrumb">
      <button type="button" class="icon-button menu-button" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="${mobileMenu}" data-action="menu">${icon('menu')}</button>
      <strong>${section}</strong>
    </div>
    <div class="top-actions">
      <a href="#notifications" class="icon-button" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${icon('bell')}${unread ? '<span class="bell-dot"></span>' : ''}</a>
      <button type="button" class="profile profile-head btn secondary" aria-label="My profile" data-action="profile">${avatar(person)}
        <span><span class="profile-name">${e(person.name)}</span><span class="profile-role">${e(person.role)}</span></span></button>
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
    ${mapLink(office)}
  </div></section>`;
}

function googleMapsUrl({ latitude, longitude }) {
  const pin = encodeURIComponent(`${latitude},${longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${pin}`;
}

function mapLink(site, named = false) {
  if (!site) return '';
  return `<a class="text-link" href="${e(googleMapsUrl(site))}" target="_blank" rel="noopener noreferrer"${named ? ` aria-label="Open in Google Maps · ${e(site.name)}"` : ''}>Open in Google Maps${icon('external-link')}</a>`;
}

function dashboard() {
  if (!manager()) return hrViews.dashboard();
  const now = Date.now();
  const upcoming = state.tasks.filter((task) => task.shoot_status === 'booked' && !task.completed_at && task.start_at + task.estimate * 60_000 > now);
  const { received, outstanding, expenses, net } = totals();
  return `
    ${heading('Admin Dashboard', 'Manage the studio’s people, shoots, and finances.', actionButton('Schedule shoot', 'new-shoot', 'plus'))}
    <p class="dashboard-date">${studioDate.format(now)}</p>
    ${metrics([
      ['Employees', state.employees.filter((person) => !person.is_admin).length, 'users', 'peach'],
      ['Upcoming shoots', upcoming.filter((task) => task.category === 'Photo shoot').length, 'calendar-days', 'lavender'],
      ['Pending approvals', pendingRequests().length, 'clipboard-check', 'sand'],
      ['Payments received', money(received), 'wallet', 'sage'],
    ])}
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Upcoming schedule</h2><p>Assigned work appears first.</p></div>${viewLink('schedule', 'View schedule')}</div>
        ${state.attendanceGaps.some((gap) => gap.resolved_at === null) ? `<p class="location-watch">Location verification is interrupted for ${state.attendanceGaps.filter((gap) => gap.resolved_at === null).length} active shifts. ${viewLink('attendance', 'Review attendance')}</p>` : ''}
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
      <p class="hr-muted" id="work-target">${workTargetLabel()}</p>
      ${!shift && sites.length ? `<label class="clock-site">Check-in site
        <select id="clock-target">
          ${state.office ? '<option value="">' + e(state.office.name) + '</option>' : ''}
          ${sites.map((task) => {
            const count = shootSites(task).length;
            return `<option value="${task.id}" ${String(task.id) === clockTarget ? 'selected' : ''}>${e(task.title)} · ${count > 1 ? `${count} locations` : e(task.location)}</option>`;
          }).join('')}
        </select></label>` : ''}
      ${(shift || !sites.length) && boundSite ? `<p class="hr-clock-site">${icon('map-pin')}${e(boundSite.name)}</p>` : ''}
      <div class="hr-clock-buttons">${clockButton('Check in', 'log-in', canClockIn)}${clockButton('Check out', 'log-out', canClockOut)}</div>
      ${officeHours ? `<p class="hr-muted">${officeHours}</p>` : ''}
      <p class="hr-muted">${canClockIn || canClockOut ? `GPS verification within ${fenceRadius} m is required.` : 'No check-in site is available.'}</p>
      <p class="location-watch" data-location-watch role="status"></p>
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
  return `<a class="map-link" target="_blank" rel="noopener noreferrer" href="${e(googleMapsUrl(place))}">${coords}</a>
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
    const gap = state.attendanceGaps.find((entry) => entry.attendance_id === shift.id);
    return `<tr><td><div class="inline">${avatar(person)}<div><strong>${e(person?.name)}</strong><small>${e(person?.role)}</small></div></div></td>
      <td>${time(shift.clock_in)}<small>${shortDate.format(shift.clock_in)}${shift.in_reason === 'geofence' ? ' · Auto return' : ''}</small></td>
      <td>${shift.clock_out ? `${time(shift.clock_out)}<small>${shortDate.format(shift.clock_out)}${shift.out_reason === 'geofence' ? ' · Left site' :
        shift.out_reason === 'account-deactivated' ? ' · Account deactivated' : ''}</small>` : '—'}</td>
      <td>${siteName ? `<strong>${e(siteName)}</strong><br>` : ''}${locationCell(shift.in_location)}</td>${full ? `<td>${locationCell(shift.out_location)}</td>` : ''}
      <td>${full && shift.clock_out ? duration(shift.clock_out - shift.clock_in) : shift.clock_out ? tag('Clocked out', 'neutral') : tag('Clocked in', 'sage')}
        ${gap ? `<small>${gap.resolved_at === null ? 'Location unverified since' : 'Location gap began at'} ${time(gap.start_at)} IST</small>` : ''}</td></tr>`;
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
    person.deactivated ? tag('Inactive', 'neutral') : person.has_login ? tag('Login set', 'sage') : tag('Credentials needed', 'sand'),
    ...(state.calendarFeeds ? [calendarFeedStatus(person.id)] : []),
    shiftFor(person.id) ? tag('Clocked in', 'sage') : tag('Clocked out', 'neutral'),
    state.tasks.filter((task) => assignedTo(task, person.id) && !task.completed_at && task.shoot_status === 'booked').length,
    actionButton('Edit employee', 'edit-employee', 'pencil', 'secondary', person.id),
  ]);
  return `${heading('Employees', 'Manage profiles and sign-in credentials.', `<div class="card-actions">
    ${actionButton('Access history', 'access-audit', 'list', 'secondary')}${actionButton('Add employee', 'new-employee', 'user-plus')}</div>`)}
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
    ${actionButton('Connect calendar', 'calendar-open', 'calendar-plus', 'secondary')}
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
    if (!shootSites(task).length) return '<p class="task-location-note">A shoot location needs to be set before check-in.</p>';
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
  const sites = shootSites(task);
  const editing = manager() && isShoot && task.completed_at ? state.tasks.find((item) => item.parent_shoot_id === task.id) : null;
  return `<article class="${inDialog ? '' : 'panel task-card'}">
    ${inDialog ? '' : `<div class="panel-head"><div><h2>${e(task.title)}</h2><p>${e(task.category)}</p></div>
      <div class="row-tags">${priority(task)}${taskStatus(task)}</div></div>`}
    <div class="task-details">
      ${task.crew?.length ? `<div class="inline">${icon('users')}${e(task.crew.map((member) => member.name).join(', '))}</div>` :
        manager() ? `<div class="inline">${icon('user-round')}${task.is_open ? 'Open to employee requests' : e(employee(task.employee_id)?.name)}</div>` : ''}
      <div class="inline">${icon('calendar-days')}${task.shoot_status === 'postponed' ? 'Awaiting a new date' :
        `${shortDate.format(task.start_at)} · ${time(task.start_at)}${isShoot || task.parent_shoot_id ? ` – ${shootEndLabel(task)}` : ''} IST`}</div>
      ${sites.length > 1 ? `<div class="shoot-site-list"><strong>Shoot locations</strong><ul>
        ${sites.map((site) => `<li class="inline">${icon('map-pin')}<span>${e(site.name)}</span> ${mapLink(site, true)}</li>`).join('')}
      </ul></div>` : `<div class="inline">${icon('map-pin')}${e(task.location)} ${mapLink(sites[0])}</div>`}
      ${task.source_shoot_title ? `<div class="inline">${icon('camera')}<span>Shoot · ${e(task.source_shoot_title)}</span></div>` : ''}
      ${task.delivery_due_at ? `<div class="inline">${icon('clock-3')}<span>Delivery due ${shortDate.format(task.delivery_due_at)} at ${time(task.delivery_due_at)} IST</span></div>` : ''}
      ${task.client_name ? `<div class="inline">${icon('contact-round')}${e(task.client_name)} · <a class="map-link" href="tel:${e(task.client_phone)}">${e(task.client_phone)}</a></div>` : ''}
      ${manager() && isShoot ? `<div class="inline">${icon('indian-rupee')}${money(task.income_paise)} expected income</div>` : ''}
    </div>
    ${task.blocked_reason ? `<p class="hr-task-note"><strong>Blocked</strong><br>${e(task.blocked_reason)}</p>` : ''}
    <div class="task-times">
      <div><small>Scheduled duration</small><strong>${duration(task.estimate * 60_000)}</strong></div>
      <div><small>${manager() && task.crew?.length > 1 ? 'Crew time tracked' : 'Time tracked'}</small><strong ${activeSession(task) ? `data-elapsed="${task.id}"` : ''}>${elapsed(task)}</strong></div>
    </div>
    ${editing ? `<div class="editing-handoff">
      <div><strong>Editing · ${e(employee(editing.employee_id)?.name)}</strong><p>${shortDate.format(editing.start_at)} · ${time(editing.start_at)} – ${shootEndLabel(editing)} IST</p>
      <p>Delivery due ${shortDate.format(editing.delivery_due_at)} at ${time(editing.delivery_due_at)} IST</p></div>
      ${taskStatus(editing)}${!editing.completed_at && editing.delivery_due_at < Date.now() ? tag('Delivery overdue', 'peach') : ''}
      ${actionButton('View editing', 'details', 'arrow-right', 'secondary', editing.id)}
    </div>` : ''}
    <div class="card-actions">${workControls(task)}
      ${manager() && (isShoot || !task.completed_at) ? actionButton('Edit schedule', 'edit-task', 'pencil', 'secondary', task.id) : ''}
      ${manager() && isShoot && task.completed_at && !editing ? actionButton('Schedule editing', 'schedule-editing', 'calendar-plus', 'primary', task.id) : ''}
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
  const report = financeReport(state, financeMonth, today(), day);
  const period = financeMonth ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: zone })
    .format(Date.parse(`${financeMonth}-01T12:00:00+05:30`)) : 'All time';
  const rows = report.shoots.map(({ task, expected, received, pending, cancelled }) => {
    const date = task.payment_due_on;
    return [`<strong>${e(task.title)}</strong><small>${e(task.client_name || 'No client')}</small>`,
      money(expected), money(received), money(pending), date ? e(date) : '—',
      cancelled ? tag('Cancelled', 'neutral') : `<div class="finance-actions">
        ${pending > 0 ? actionButton('Record payment', 'record-payment', 'plus', 'secondary', task.id) : tag('Settled', 'sage')}
        ${actionButton(date ? 'Edit due date' : 'Set due date', 'payment-due', 'calendar-days', 'secondary', task.id)}
      </div>`];
  });
  const overdueRows = report.overdue.map(({ task, pending }) => [
    `<strong>${e(task.title)}</strong><small>${e(task.client_name || 'No client')}</small>`, e(task.payment_due_on), money(pending),
    actionButton('Record payment', 'record-payment', 'plus', 'secondary', task.id),
  ]);
  const paymentRows = report.payments.map((entry) => [e(entry.paid_on),
    e(state.tasks.find((task) => task.id === entry.task_id)?.title), money(entry.amount_paise), e(entry.note || '—'),
    actionButton('Edit payment', 'edit-payment', 'pencil', 'secondary', entry.id)]);
  const expenseRows = report.expenses.map((entry) => [e(entry.spent_on), e(entry.name), e(entry.category), money(entry.amount_paise), e(entry.note || '—'),
    actionButton('Edit expense', 'edit-expense', 'pencil', 'secondary', entry.id)]);
  return `${heading('Finances', 'Track shoot income, payments, and studio expenses in INR.', actionButton('Add expense', 'add-expense', 'plus'))}
    <section class="panel finance-toolbar" aria-label="Finance report filters">
      <div><h2>${period}</h2><p>Payments and expenses use the date they were recorded against. Shoot balances use the scheduled shoot date.</p></div>
      <div class="finance-actions"><label>Report month<input type="month" id="finance-month" value="${e(financeMonth)}" placeholder="YYYY-MM"></label>
        ${financeMonth ? actionButton('All time', 'finance-clear', 'calendar-days', 'secondary') : ''}
        ${actionButton('Export CSV', 'export-finance', 'download', 'secondary')}</div>
    </section>
    ${metrics([['Expected shoot income', money(report.expected), 'indian-rupee', 'lavender'],
      ['Payments received', money(report.received), 'wallet', 'sage'], ['Pending for these shoots', money(report.outstanding), 'hourglass', 'sand'],
      ['Expenses', money(report.spent), 'receipt', 'peach']])}
    <section class="panel net-panel"><div><h2>Cash profit ${financeMonth ? 'for the month' : 'to date'}</h2><p>Payments received less expenses recorded</p></div><strong>${money(report.net)}</strong></section>
    <section class="panel finance-table"><div class="panel-head"><div><h2>Overdue payments</h2><p>Unpaid balances with a due date before today, across all shoots.</p></div>
      ${overdueRows.length ? tag(money(report.overdue.reduce((sum, entry) => sum + entry.pending, 0)) + ' overdue', 'sand') : ''}</div>
      ${overdueRows.length ? table('Overdue payments', ['Shoot', 'Due date', 'Outstanding', 'Actions'], overdueRows) : empty('No overdue payments.')}</section>
    <section class="panel finance-table"><div class="panel-head"><div><h2>Shoot balances</h2><p>Balances include all payments made against each shoot.</p></div></div>
      ${rows.length ? table('Shoot balances', ['Shoot', 'Expected', 'Received', 'Pending', 'Due date', 'Actions'], rows) : empty('No shoots in this period.')}</section>
    <div class="dashboard-grid ledger-panels">
      <section class="panel"><div class="panel-head"><div><h2>Payment history</h2></div></div>
        ${paymentRows.length ? table('Payments', ['Date', 'Shoot', 'Amount', 'Reference', 'Actions'], paymentRows) : empty('No payments recorded.')}</section>
      <section class="panel expense-ledger"><div class="panel-head"><div><h2>Expense history</h2></div></div>
        ${expenseRows.length ? table('Expenses', ['Date', 'Expense', 'Category', 'Amount', 'Notes', 'Actions'], expenseRows) : empty('No expenses recorded.')}</section>
    </div>`;
}

function exportFinances() {
  const report = financeReport(state, financeMonth, today(), day);
  const url = URL.createObjectURL(new Blob([financeCsv(report, financeMonth, state.tasks)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `concept-photography-finances-${financeMonth || 'all-time'}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mobileAlertControls() {
  if (!webPushEnabled) return { description: 'Reminders appear in this workspace while it’s open.' };
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

function locationCheckSites() {
  const sites = new Map();
  const key = (site) => site.taskId ? `${site.taskId}:${site.latitude},${site.longitude}` : 'office';
  const bound = trackingTarget()?.site;
  if (bound) sites.set(key(bound), bound);
  if (state.office && !sites.has('office')) sites.set('office', state.office);
  for (const task of state.tasks) {
    if (assignedTo(task, actorId) && task.shoot_status === 'booked' && !task.completed_at && task.start_at + task.estimate * 60_000 > Date.now()) {
      for (const site of shootSites(task)) {
        if (!sites.has(key(site))) sites.set(key(site), { ...site, name: `${task.title} · ${site.name}` });
      }
    }
  }
  return sites;
}

function deviceChecks(mobile) {
  const sites = locationCheckSites();
  if (checkedSite && !sites.has(checkedSite)) {
    checkedSite = '';
    locationCheck = '';
  }
  return `<section class="panel device-checks">
    <div class="panel-head"><div><h2>Device checks</h2><p>Verify GPS and reminders on this phone before a shoot.</p></div></div>
    <div class="device-check-grid">
      <div class="device-check">
        <h3>GPS and attendance</h3>
        <p class="location-watch" data-location-watch role="status"></p>
        ${sites.size ? `<label>Location to test<select id="device-site">${[...sites].map(([id, site]) =>
          `<option value="${id}" ${id === checkedSite ? 'selected' : ''}>${e(site.name)}</option>`).join('')}</select></label>` : ''}
        ${actionButton('Test GPS', 'test-location', 'locate-fixed', 'secondary')}
        <p id="gps-result" role="status">${e(locationCheck)}</p>
      </div>
      <div class="device-check">
        <h3>Mobile reminders</h3>
        <p>${mobile.description}</p>
        <div class="card-actions">${mobile.action ?? ''}${mobileDevice?.enabled
          ? actionButton('Send test reminder', 'test-alerts', 'bell', 'secondary') : ''}</div>
        <p role="status">${e(mobileDevice?.testResult)}</p>
      </div>
    </div>
  </section>`;
}

async function prepareMobileAlerts() {
  if (!webPushEnabled || mobileDevice || needsHomeScreen() || !supportsMobileAlerts()) return;
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
  return `${heading('Notifications', 'Reminders for your assigned work.')}
    ${deviceChecks(mobile)}
    <section class="panel">
      <div class="panel-head"><div><h2>${actor() ? `Reminders for ${e(actor().name)}` : 'Work reminders'}</h2></div>
      ${notices.some((notice) => !notice.read_at) ? actionButton('Mark all read', 'read', 'check-check', 'secondary') : ''}</div>
      ${notices.length ? notices.map((notice) => `<div class="notice-row">
        ${tile('bell', 'peach')}<div><h3>${e(notice.title)}</h3>
        <p>Scheduled for ${shortDate.format(notice.start_at)} at ${time(notice.start_at)} IST</p></div>${notice.read_at ? '' : tag('Unread', 'peach')}
      </div>`).join('') : empty('No reminders yet.')}
    </section>`;
}


let hrViews;
let hrViewsPromise;

function loadHrViews() {
  hrViewsPromise ??= import('./hr-views.js').then(({ createHrViews }) => {
    hrViews = createHrViews({
      actor, state: () => state, manager, e, icon, tag, heading, viewLink, empty, actionButton, time, timeInput: studioTimeInput,
      day, today, money, duration, employee, table, clockCard, attendanceTable, sessionsFor, activeSession, entryForm, openDialog, applyAction, render, shootEndLabel,
    });
  }).catch((error) => {
    hrViewsPromise = undefined;
    throw error;
  });
  return hrViewsPromise;
}

const pages = {
  dashboard, team: teamPage, schedule: schedulePage, 'shoot-calendar': () => hrViews.shootCalendar(),
  'task-board': () => hrViews.taskBoard(), 'work-log': () => hrViews.workLog(), leave: () => hrViews.leave(), payroll: () => hrViews.payroll(),
  announcements: () => hrViews.announcements(), clients: clientsPage, approvals: approvalsPage,
  work: availableWorkPage, finances: financesPage, attendance: () => hrViews.attendance(), notifications: notificationsPage,
};

function render() {
  if (!actor()) return;
  document.body.classList.remove('signed-out');
  displayedDate = today();
  shownShootIds = shootIds();
  renderChrome();
  if (snapshot === undefined) {
    const title = page === 'dashboard' ? (manager() ? 'Admin Dashboard' : 'My Dashboard') : e(nav().find(([key]) => key === page)[1]);
    main.innerHTML = `<div class="page-head"><h1>${title}</h1></div><section class="panel">
      ${initialLoadError ? `<p class="loading" role="status">Could not load the workspace data.</p>
        ${actionButton('Retry', 'retry-dashboard', 'refresh-cw', 'secondary')}` : '<p class="loading" role="status">Loading workspace data…</p>'}
    </section>`;
    return;
  }
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
  if (!actor() || snapshot === undefined) return;
  if (displayedDate !== today() || shownShootIds !== shootIds()) {
    render();
    return;
  }
  processLocation();
  sampleActiveShift();
  const hours = document.querySelector('#today-hours');
  if (hours) hours.textContent = hrViews.todayClock();
  const target = document.querySelector('#work-target');
  if (target) target.textContent = workTargetLabel();
  document.querySelectorAll('[data-elapsed]').forEach((element) => {
    const task = state.tasks.find((item) => item.id === Number(element.dataset.elapsed));
    if (task) element.textContent = elapsed(task);
  });
}

function workTargetLabel() {
  const { required, remaining, aboveTarget } = hrViews.workTarget();
  if (!required) return 'No working-hours target today.';
  return `${duration(required)} target · ${aboveTarget ? duration(aboveTarget) + ' above target' : remaining ? duration(remaining) + ' remaining' : 'Target met'}`;
}

async function request(path, body) {
  try {
    return await workspaceRequest(path, body);
  } catch (error) {
    if (error.status === 401 && path !== 'login' && session?.actor) clearWorkspace({ actor: null });
    throw error;
  }
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
  initialLoadError = false;
  snapshot = undefined;
  state = initialState();
  actorId = undefined;
  mobileDevice = undefined;
  checkedSite = '';
  locationCheck = '';
  financeMonth = '';
  session = info;
  clockTarget = '';
  employeeFilter = 'all';
  scheduleFilter = 'upcoming';
  hrViews?.reset();
  mobileMenu = false;
  if (dialog.open) dialog.close();
  clearTimeout(toastTimer);
  toast.hidden = true;
  stopTracking();
  loginPage();
}

async function refresh({ force = false } = {}) {
  if (!force && (!session?.actor || loading)) return;
  const version = ++refreshVersion;
  loading = true;
  try {
    const [fresh] = await Promise.all([request('state'), loadHrViews()]);
    if (version !== refreshVersion) return;
    session = { actor: fresh.actor };
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
  } catch (error) {
    if (version === refreshVersion && actor() && snapshot === undefined && !initialLoadError) {
      initialLoadError = true;
      render();
    }
    throw error;
  } finally {
    if (version === refreshVersion) loading = false;
  }
}

export async function finishSignIn({ actor: person }) {
  sessionVersion++;
  history.replaceState(null, '', '#dashboard');
  if (!person) {
    await refresh({ force: true });
    return;
  }
  session = { actor: person };
  state = { ...initialState(), employees: [person] };
  actorId = person.id;
  snapshot = undefined;
  initialLoadError = false;
  page = 'dashboard';
  render();
  refresh({ force: true }).catch(() => {});
}

async function refreshAfterSave() {
  try {
    await refresh({ force: true });
  } catch {
    if (actor()) showToast('Saved. The page will update when the connection returns.');
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

function profileForm(note) {
  openDialog('My profile', e(actor().email), `
    ${actionButton('Change password', 'change-password', 'key-round', 'secondary')}
    ${entryForm('profile/notes', `<label class="full">Private notepad<textarea name="note" rows="6" maxlength="6000">${e(note)}</textarea></label>`, 'Save notes')}
  `);
}

function passwordForm() {
  openDialog('Change password', 'You’ll sign in again after saving.', entryForm('profile/password', `
    ${passwordField({ id: 'old-password', name: 'currentPassword', label: 'Current password' })}
    ${passwordField({ id: 'new-password', label: 'New password', newPassword: true })}
  `, 'Save password'));
}

function accessForm(person) {
  const active = Boolean(person.deactivated);
  openDialog(active ? 'Activate account' : 'Deactivate account', e(person.name), entryForm('employees/access', `
    <input type="hidden" name="id" value="${person.id}">
    <input type="hidden" name="active" value="${active}">
    <p class="full">${active ? 'The employee will be able to sign in again.' : 'This ends active sessions and stops any running attendance and task timers. Their records stay available.'}</p>
  `, active ? 'Activate account' : 'Deactivate account'));
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

function mapFields(site = {}, additional = false) {
  const fields = additional ? ['additionalMapsUrl', 'additionalLatitude', 'additionalLongitude'] : ['mapsUrl', 'latitude', 'longitude'];
  return `<div class="full form-grid map-fields">
    <label class="full">${additional ? 'Google Maps link for this location (optional)' : 'Google Maps link (optional)'}<input name="${fields[0]}" type="url" maxlength="2048" placeholder="https://maps.app.goo.gl/…" value="${e(site.maps_url)}"></label>
    <details class="full coordinates" ${site.latitude != null && !site.maps_url ? 'open' : ''}>
      <summary>Use latitude and longitude</summary>
      <div class="form-grid">
        <label>Latitude<input name="${fields[1]}" type="number" min="-90" max="90" step="any" value="${e(site.latitude)}"></label>
        <label>Longitude<input name="${fields[2]}" type="number" min="-180" max="180" step="any" value="${e(site.longitude)}"></label>
      </div>
    </details>
  </div>`;
}

function additionalSiteFields(site, number, allowRemove) {
  return `<fieldset class="extra-shoot-site form-grid" data-shoot-site>
    <legend>Location ${number}</legend>
    <label class="full">Location name (optional)<input name="additionalLocationName" maxlength="100" value="${e(site.name)}"></label>
    ${mapFields(site, true)}
    <div class="full" ${allowRemove ? '' : 'hidden'}>${actionButton('Remove location', 'remove-shoot-site', 'trash-2', 'secondary')}</div>
  </fieldset>`;
}

function additionalSiteControls(task) {
  const saved = additionalShootLocations(task);
  const rows = saved.length ? saved : [{}];
  return `<label class="full shoot-multiple-toggle"><input name="multipleShootLocations" type="checkbox" aria-controls="additional-shoot-sites"
    ${saved.length ? 'checked' : ''}> Multiple shoot locations</label>
    <fieldset class="full additional-shoot-sites" id="additional-shoot-sites" ${saved.length ? '' : 'hidden disabled'}>
      <legend>Additional locations</legend>
      <p class="field-note">Enter a Maps link or coordinates for each stop. Assigned crew can check in at any saved pin.</p>
      <div class="additional-shoot-list" data-shoot-site-list>${rows.map((site, index) => additionalSiteFields(site, index + 2, rows.length > 1)).join('')}</div>
      <div ${rows.length >= maxAdditionalShootSites ? 'hidden' : ''}>${actionButton('Add another location', 'add-shoot-site', 'plus', 'secondary')}</div>
    </fieldset>`;
}

function updateSiteRows(group) {
  const rows = group.querySelectorAll('[data-shoot-site]');
  rows.forEach((row, index) => {
    row.querySelector('legend').textContent = `Location ${index + 2}`;
    row.querySelector('[data-action="remove-shoot-site"]').parentElement.hidden = rows.length === 1;
  });
  group.querySelector('[data-action="add-shoot-site"]').parentElement.hidden = rows.length >= maxAdditionalShootSites;
}

function addSiteRow(group) {
  const list = group.querySelector('[data-shoot-site-list]');
  if (list.children.length >= maxAdditionalShootSites) return;
  list.insertAdjacentHTML('beforeend', additionalSiteFields({}, list.children.length + 2, true));
  updateSiteRows(group);
  list.lastElementChild.querySelector('[name="additionalMapsUrl"]').focus();
}

function locationForm() {
  const office = state.office;
  openDialog('Company location', 'Enter the office coordinates or a Google Maps link.', entryForm('office', `
    <label class="full">Location name<input name="name" required maxlength="100" value="${e(office?.name || 'Concept Photography')}"></label>
    ${mapFields(office ?? {})}
  `, 'Save location'));
}

function taskForm(task, type = 'all', sourceShoot = null) {
  const isBoard = type === 'board';
  const self = !manager();
  const parentShootId = sourceShoot?.id ?? task?.parent_shoot_id;
  const category = task?.category || (isBoard || parentShootId ? 'Editing' : 'Photo shoot');
  const isShoot = category === 'Photo shoot';
  const completed = isShoot && Boolean(task?.completed_at);
  const isOpen = Boolean(task?.is_open);
  const employees = state.employees.filter((person) => (person.has_login || person.is_admin) &&
    (!person.deactivated || task?.employee_id === person.id || task?.crew?.some((member) => member.employee_id === person.id)));
  const staff = employees.filter((person) => !person.is_admin);
  const selected = (isOpen ? null : task?.employee_id) ?? staff[0]?.id ?? actorId;
  const clientId = task?.client_id;
  const title = task ? 'Edit schedule' : parentShootId ? 'Schedule editing' : isBoard ? (self ? 'Add task' : 'Assign task') : 'Schedule shoot';
  const defaultTitle = sourceShoot ? `Editing · ${sourceShoot.title}`.slice(0, 100) : '';
  openDialog(title,
    parentShootId ? e(sourceShoot?.title ?? task.source_shoot_title) : completed ? 'Update the completed shoot’s details and scheduled times.' : self ? 'This task will appear on your board.' :
      'Direct assignments are marked as priority on the employee’s schedule.', entryForm('tasks', `
    ${task ? `<input type="hidden" name="id" value="${task.id}"><input type="hidden" name="category" value="${e(category)}">` : ''}
    ${parentShootId ? `<input type="hidden" name="parentShootId" value="${parentShootId}">` : ''}
    <label class="full">${parentShootId ? 'Editing task name' : 'Shoot or task name'}<input name="title" required maxlength="100" value="${e(task?.title ?? defaultTitle)}"></label>
    ${!task ? parentShootId || type === 'shoot' ? `<input type="hidden" name="category" value="${category}">` :
      `<label>Work type<select name="category">${Object.keys(categories).filter((name) => !isBoard || name !== 'Photo shoot').map((name) => `<option>${name}</option>`).join('')}</select></label>` : ''}
    ${self ? '' : completed ? `<input type="hidden" name="employeeId" value="${task.employee_id}">` :
      `${parentShootId ? '' : `<label>Assignment<select name="assignment"><option value="assigned">Assign directly</option><option value="open" ${isOpen ? 'selected' : ''}>Open for employee requests</option></select></label>`}
    <label class="full assignee" ${isOpen ? 'hidden' : ''}>${parentShootId ? 'Editor' : 'Assigned employee or shoot lead'}<select name="employeeId" required ${isOpen ? 'disabled' : ''}>
      ${sourceShoot ? '<option value="">Choose an editor</option>' : ''}
      ${[...staff, ...employees.filter((person) => person.is_admin)].map((person) => `<option value="${person.id}" ${!sourceShoot && person.id === selected ? 'selected' : ''}>${e(person.name)}</option>`).join('')}</select></label>`}
    <fieldset class="full shoot-time-fields" ${isShoot || parentShootId ? '' : 'hidden disabled'}><legend>${parentShootId ? 'Editing time' : 'Shoot time'}</legend>
      <div class="form-grid">
        <label>From (IST)<input name="shootFrom" type="datetime-local" required value="${task ? studioDateTimeInput(task.start_at) : ''}"></label>
        <label>To (IST)<input name="shootTo" type="datetime-local" required value="${task ? studioDateTimeInput(task.start_at + task.estimate * 60_000) : ''}" aria-describedby="shoot-time-help"></label>
      </div>
      <p class="field-note" id="shoot-time-help">The work can end the next day and run for up to 24 hours.</p>
    </fieldset>
    <fieldset class="full task-time-fields" ${isShoot || parentShootId ? 'hidden disabled' : ''}>
      <label>Scheduled date<input name="startDate" type="date" required value="${task ? day(task.start_at) : today()}"></label>
      <label>Scheduled time (IST)<input name="startTime" type="time" required value="${task ? studioTimeInput.format(task.start_at) : ''}"></label>
      <label>Duration in minutes<input name="estimate" type="number" required min="1" max="1440" value="${task?.estimate ?? 60}"></label>
    </fieldset>
    ${parentShootId ? `<label>Delivery deadline (IST)<input name="deliveryDue" type="datetime-local" required value="${task?.delivery_due_at ? studioDateTimeInput(task.delivery_due_at) : ''}"></label>` : ''}
    <label>Location name<input name="location" required maxlength="100" value="${e(task?.location ?? (sourceShoot ? state.office?.name : ''))}"></label>
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
        ${additionalSiteControls(task)}
        <label class="full">Expected shoot income (₹)<input name="income" type="number" required min="0" max="999999999.99" step="0.01" value="${task ? task.income_paise / 100 : ''}"></label>
        <label class="full">Payment due date (optional)<input name="paymentDueOn" type="date" value="${e(task?.payment_due_on)}"></label>
      </div>
    </fieldset>
    ${manager() ? '<section class="full schedule-conflicts" data-conflicts tabindex="-1" aria-label="Scheduling conflicts" hidden></section>' : ''}
  `, 'Save schedule'));
}

function showScheduleConflicts(form, conflicts) {
  const notice = form.querySelector('[data-conflicts]');
  notice.innerHTML = `<h3>Scheduling conflicts</h3><ul>${conflicts.map((entry) => {
    const details = entry.title
      ? `${e(entry.title)} · ${shortDate.format(entry.start_at)}, ${time(entry.start_at)} – ${shootEndLabel({ start_at: entry.start_at, estimate: (entry.end_at - entry.start_at) / 60_000 })} IST`
      : `Approved ${entry.leave_type === 'half' ? 'half-day leave' : 'leave'} · ${e(entry.day_from)}${entry.day_to === entry.day_from ? '' : ` to ${e(entry.day_to)}`}`;
    return `<li data-conflict-key="${e(entry.key)}"><strong>${e(entry.name)}</strong> · ${details}</li>`;
  }).join('')}</ul><label class="conflict-confirm"><input type="checkbox" name="acceptConflicts" required> ${form.dataset.form === 'request-decisions' ? 'Approve' : 'Save'} despite these conflicts</label>`;
  notice.hidden = false;
  notice.focus();
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

function paymentDueForm(task) {
  openDialog('Payment due date', e(task.title), entryForm('payment-due', `
    <input type="hidden" name="taskId" value="${task.id}">
    <label class="full">Due date<input name="paymentDueOn" type="date" value="${e(task.payment_due_on)}"></label>
    <p class="full field-note">Clear the date to remove it from overdue tracking.</p>
  `, 'Save due date'));
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
const observationRetryDelay = 3_000;
const verificationInterval = 60_000;

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
  return site ? { site, current, shiftId: latest.id, verifiedAt: latest.last_verified_at ?? latest.clock_in } : null;
}

function setWatchStatus(message) {
  document.querySelectorAll('[data-location-watch]').forEach((element) => {
    if (element.textContent !== message) element.textContent = message;
  });
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
    const message = target ? 'Automatic tracking is off. Allow location access to record departures and returns.'
      : latestShift()?.resume_pending ? 'Auto return is unavailable for this site. You can clock in at an eligible site.'
      : 'Automatic tracking is off. It starts after a verified check-in.';
    setWatchStatus(message);
    return;
  }
  if (!watcher) {
    const watching = { employeeId: actorId, retryAt: 0 };
    watcher = watching;
    watching.id = navigator.geolocation.watchPosition((position) => {
      if (watcher !== watching) return;
      lastFix = { location: toFix(position), employeeId: watching.employeeId };
      watching.fix = lastFix.location;
      watching.error = '';
      updateTracking();
      processLocation();
    }, (error) => {
      if (watcher !== watching) return;
      if (error.code === 1) {
        permissionGranted = false;
        render();
      }
      watching.error = locationError(error);
      updateTracking();
    }, locationOptions);
  }
  const action = target.current ? `automatic clock-out from ${target.site.name}` : `automatic clock-in when you return to ${target.site.name}`;
  if (state.attendanceGaps.some((gap) => gap.attendance_id === target.shiftId && gap.resolved_at === null)) {
    setWatchStatus('Location unverified. Keep the workspace open and allow GPS to resume verification.');
  } else if (navigator.onLine === false) setWatchStatus('Waiting for an internet connection to update attendance.');
  else if (watcher.retryAt > Date.now()) setWatchStatus('Could not update attendance. Retrying automatically.');
  else if (watcher.error) setWatchStatus(watcher.error);
  else if (!watcher.fix) setWatchStatus(`Waiting for GPS for ${action}.`);
  else if (presenceAt(watcher.fix, target.site) === 'uncertain') setWatchStatus('Automatic tracking is waiting for a clearer GPS signal.');
  else setWatchStatus(`Tracking active for ${action}. Last GPS reading at ${time(watcher.fix.capturedAt)} IST. Keep the workspace open and your phone awake.`);
}

function sampleActiveShift() {
  const watch = watcher;
  const shift = latestShift();
  const now = Date.now();
  if (!watch || readingLocation || pending || observing || navigator.onLine === false || document.visibilityState !== 'visible' ||
      shift?.clock_out !== null || now < Math.max(watch.sampleAfter ?? 0, (shift.last_verified_at ?? shift.clock_in) + verificationInterval)) return;
  watch.sampleAfter = now + verificationInterval;
  navigator.geolocation.getCurrentPosition((position) => {
    if (watcher !== watch) return;
    watch.fix = toFix(position);
    watch.error = '';
    lastFix = { location: watch.fix, employeeId: watch.employeeId };
    updateTracking();
    processLocation();
  }, (error) => {
    if (watcher !== watch) return;
    watch.error = locationError(error);
    updateTracking();
  }, locationOptions);
}

function restartLocationTracking() {
  if (snapshot === undefined || readingLocation || !trackingTarget()) return;
  stopTracking();
  updateTracking();
}

function testLocation(button) {
  mutate(button, async () => {
    const id = document.querySelector('#device-site')?.value;
    const site = locationCheckSites().get(id);
    const result = document.querySelector('#gps-result');
    if (result) result.textContent = 'Checking GPS…';
    try {
      const fix = await getLocation();
      const status = site ? {
        inside: `Within ${fenceRadius} m of ${site.name}.`,
        outside: `Outside the ${fenceRadius} m boundary for ${site.name}.`,
        uncertain: `GPS could not verify the boundary for ${site.name}. Move closer or try again with a clearer signal.`,
      }[presenceAt(fix, site)] : 'GPS is available.';
      locationCheck = `${status} Accuracy about ${Math.round(fix.accuracy)} m.`;
    } catch (error) {
      locationCheck = error.message;
    }
    const activeResult = document.querySelector('#gps-result');
    if (activeResult) activeResult.textContent = locationCheck;
  });
}

async function processLocation() {
  const watch = watcher;
  if (!watch || !lastFix || lastFix.employeeId !== actorId || pending || observing ||
      navigator.onLine === false || Date.now() < watch.retryAt) return;
  const observation = lastFix;
  const target = trackingTarget();
  const { location, employeeId } = observation;
  lastFix = undefined;
  if (!target) return;
  if (Date.now() - location.capturedAt > maxFixAge) {
    if (watch.retryAt) restartLocationTracking();
    return;
  }
  if (watch.retryAt) {
    watch.retryAt = 0;
    updateTracking();
  }
  const presence = presenceAt(location, target.site);
  const verify = target.current && presence === 'inside' &&
    Date.now() >= Math.max(target.verifiedAt, watch.verifiedAt ?? 0) + verificationInterval;
  if (!verify && presence !== (target.current ? 'outside' : 'inside')) return;
  observing = true;
  try {
    let shift;
    try {
      shift = await request('attendance', { shiftId: target.shiftId, action: verify ? 'verify' : 'observe', location });
    } catch (error) {
      if (watcher !== watch) return;
      if (!error.status || error.status >= 500 || error.status === 429) {
        lastFix ??= observation;
        watch.retryAt = Date.now() + observationRetryDelay;
        updateTracking();
      } else {
        setWatchStatus(error.message);
      }
      return;
    }
    if (actorId !== employeeId) return;
    if (verify) {
      watch.verifiedAt = Date.now();
      if (state.attendanceGaps.some((gap) => gap.attendance_id === target.shiftId && gap.resolved_at === null)) {
        await refresh({ force: true }).catch(() => {});
      }
      return;
    }
    await refreshAfterSave();
    if (shift && actorId === employeeId) {
      showToast(target.current ? `Clocked out automatically after leaving ${target.site.name}.`
        : `Clocked back in automatically at ${target.site.name}.`);
    }
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
  const controls = button.closest('dialog, .card-actions, .hr-clock-buttons')?.querySelectorAll('button:not(:disabled, [data-action="close"])') ?? [button];
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
  'payment-due': 'Payment due date saved.', 'request-decisions': 'Request approved.',
  'profile/notes': 'Notes saved.', 'employees/access': 'Account access updated.',
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
      showToast(`Clocked ${action}. Time and location recorded.`);
      await refreshAfterSave();
    } finally {
      button.lastChild.textContent = label;
    }
  });
}

function applyAction(button, path, body, message, close = false) {
  mutate(button, async () => {
    await request(path, body);
    if (close && dialog.open && dialog.contains(button)) dialog.close();
    if (message) showToast(message);
    await refreshAfterSave();
  });
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-password-toggle]');
  if (toggle) {
    togglePassword(toggle);
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (!button || !actor()) return;
  const { action, value } = button.dataset;
  const id = Number(button.dataset.id);
  const task = () => state.tasks.find((item) => item.id === id);
  if (snapshot === undefined && !['menu', 'sign-out', 'retry-dashboard'].includes(action)) return;
  if (hrViews && Object.hasOwn(hrViews.actions, action)) {
    hrViews.actions[action](button, value, id);
    return;
  }
  switch (action) {
    case 'retry-dashboard':
      initialLoadError = false;
      render();
      refresh({ force: true }).catch(() => {});
      break;
    case 'menu':
      mobileMenu = !mobileMenu;
      sidebar.classList.toggle('open', mobileMenu);
      button.setAttribute('aria-expanded', String(mobileMenu));
      break;
    case 'sign-out':
      mutate(button, async () => {
        const subscription = webPushEnabled ? await currentPushSubscription() : null;
        await request('logout', { pushEndpoint: subscription?.endpoint });
        if (subscription) await subscription.unsubscribe().catch(() => {});
        history.replaceState(null, '', location.pathname);
        clearWorkspace({ actor: null });
      });
      break;
    case 'close': dialog.close(); break;
    case 'details': taskDialog(task()); break;
    case 'new-employee': employeeForm(); break;
    case 'edit-employee': {
      const person = employee(id);
      employeeForm(person);
      dialog.querySelector('.dialog-actions').insertAdjacentHTML('afterbegin', actionButton(
        person.deactivated ? 'Activate account' : 'Deactivate account', 'edit-employee-access', 'user-round', 'secondary', id));
      break;
    }
    case 'edit-employee-access': accessForm(employee(id)); break;
    case 'profile':
      mutate(button, async () => profileForm((await request('profile')).note));
      break;
    case 'change-password': passwordForm(); break;
    case 'access-audit':
      mutate(button, async () => {
        const audit = await request('access-audit');
        openDialog('Access history', 'Recent account activity.', table('Access history', ['Event', 'Employee', 'Changed by', 'Time (IST)'],
          audit.map((entry) => [e(entry.action), e(entry.subject || '—'), e(entry.performer || '—'),
            `${shortDate.format(entry.occurred_at)} · ${time(entry.occurred_at)}`])));
      });
      break;
    case 'new-client': clientForm(); break;
    case 'edit-client': clientForm(state.clients.find((client) => client.id === id)); break;
    case 'new-task': taskForm(); break;
    case 'new-shoot': taskForm(null, 'shoot'); break;
    case 'add-shoot-site': addSiteRow(button.closest('.additional-shoot-sites')); break;
    case 'remove-shoot-site': {
      const group = button.closest('.additional-shoot-sites');
      button.closest('[data-shoot-site]').remove();
      updateSiteRows(group);
      group.querySelector('[data-action="add-shoot-site"]').focus();
      break;
    }
    case 'new-board-task': taskForm(null, 'board'); break;
    case 'shoot-done':
      mutate(button, async () => {
        await request('shoot-done', { taskId: id });
        await refreshAfterSave();
        if (task()?.completed_at && !dialog.open) taskDialog(task());
        dialog.querySelector('[data-action="schedule-editing"]')?.focus();
        showToast('Shoot marked done.');
      });
      break;
    case 'schedule-editing':
      taskForm(null, 'all', task());
      dialog.querySelector('[name="title"]').focus();
      break;
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
    case 'payment-due': paymentDueForm(task()); break;
    case 'finance-clear':
      financeMonth = '';
      render();
      document.querySelector('#finance-month')?.focus();
      break;
    case 'export-finance': exportFinances(); break;
    case 'edit-payment': {
      const payment = state.payments.find((item) => item.id === id);
      const shoot = state.tasks.find((item) => item.id === payment?.task_id);
      if (shoot) paymentForm(shoot, payment);
      break;
    }
    case 'add-expense': expenseForm(); break;
    case 'edit-expense': expenseForm(state.expenses.find((item) => item.id === id)); break;
    case 'approve-request':
      mutate(button, async () => {
        try {
          await request('request-decisions', { id, status: 'approved' });
          showToast('Request approved.');
          await refreshAfterSave();
        } catch (error) {
          if (!error.conflicts) throw error;
          openDialog('Review assignment', '', entryForm('request-decisions', `
            <input type="hidden" name="id" value="${id}">
            <input type="hidden" name="status" value="approved">
            <section class="full schedule-conflicts" data-conflicts tabindex="-1" aria-label="Scheduling conflicts"></section>
          `, 'Approve request'));
          showScheduleConflicts(dialog.querySelector('form'), error.conflicts);
        }
      });
      break;
    case 'decline-request':
      applyAction(button, 'request-decisions', { id, status: 'declined' }, 'Request declined.');
      break;
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
    case 'test-location': testLocation(button); break;
    case 'test-alerts':
      mutate(button, async () => {
        const device = mobileDevice;
        try {
          const subscription = await currentPushSubscription();
          if (!subscription) throw new Error('Enable mobile alerts on this device first.');
          await request('push/test', { endpoint: subscription.endpoint });
          device.testResult = 'Test accepted by your notification service. Check this phone for the reminder.';
        } catch (error) {
          device.testResult = error.message;
          if (error.status === 410) device.enabled = false;
        }
        if (actor() && page === 'notifications') render();
      });
      break;
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
        device.testResult = '';
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
        mobileDevice.testResult = '';
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
  if (input.id === 'finance-month') {
    if (input.value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.value)) {
      showToast('Enter a report month in YYYY-MM format.');
      return;
    }
    financeMonth = input.value;
    render();
    document.querySelector('#finance-month')?.focus();
    return;
  }
  if (input.id === 'device-site') {
    checkedSite = input.value;
    locationCheck = '';
    document.querySelector('#gps-result').textContent = '';
  }
  if (hrViews && Object.hasOwn(hrViews.filters, input.id)) {
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
  if (input.name === 'multipleShootLocations') {
    toggleFields(form.querySelector('.additional-shoot-sites'), input.checked);
  }
  if (['category', 'shootFrom', 'shootTo', 'employeeId', 'crew', 'assignment', 'shootStatus'].includes(input.name)) {
    const notice = form.querySelector('[data-conflicts]');
    if (notice) {
      notice.hidden = true;
      notice.replaceChildren();
    }
  }
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
  if (!['mapsUrl', 'additionalMapsUrl'].includes(event.target.name)) return;
  event.target.closest('.map-fields').querySelectorAll('input[type="number"]').forEach((field) => { field.value = ''; });
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
  if (kind === 'employees/access') data.active = data.active === 'true';
  if (kind === 'tasks') {
    if (data.category === 'Photo shoot' || data.parentShootId) {
      data.startAt = `${data.shootFrom}:00+05:30`;
      data.endAt = `${data.shootTo}:00+05:30`;
      if (form.querySelector('.crew-fields')) data.crew = fields.getAll('crew');
    } else {
      data.startAt = `${data.startDate}T${data.startTime}:00+05:30`;
    }
    if (data.parentShootId) data.deliveryDueAt = `${data.deliveryDue}:00+05:30`;
    if (data.category === 'Photo shoot') {
      const names = fields.getAll('additionalLocationName');
      const latitudes = fields.getAll('additionalLatitude');
      const longitudes = fields.getAll('additionalLongitude');
      data.additionalSites = fields.getAll('additionalMapsUrl').map((mapsUrl, index) => ({
        mapsUrl, name: names[index], latitude: latitudes[index], longitude: longitudes[index],
      }));
      delete data.additionalMapsUrl;
      delete data.additionalLocationName;
      delete data.additionalLatitude;
      delete data.additionalLongitude;
      delete data.multipleShootLocations;
    }
  }
  if (fields.has('acceptConflicts')) {
    data.acknowledgedConflicts = [...form.querySelectorAll('[data-conflict-key]')].map((item) => item.dataset.conflictKey);
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
      const result = await request(kind, data);
      if (kind === 'login') {
        await finishSignIn(result);
        return;
      }
      if (kind === 'profile/password') {
        await request('logout', {}).catch(() => {});
        history.replaceState(null, '', location.pathname);
        clearWorkspace({ actor: null });
        showToast('Password updated. Sign in with your new password.');
        return;
      }
      const ownsDialog = dialog.open && dialog.contains(form);
      if (ownsDialog) dialog.close();
      if (ownsDialog && kind === 'tasks' && !data.parentShootId && !['schedule', 'shoot-calendar', 'task-board'].includes(page)) {
        location.hash = data.category === 'Photo shoot' ? '#shoot-calendar' : '#task-board';
      }
      showToast(savedMessages[kind]);
      await refreshAfterSave();
      if (ownsDialog && kind === 'tasks' && data.parentShootId) {
        const shoot = state.tasks.find((item) => item.id === Number(data.parentShootId));
        if (shoot) {
          taskDialog(shoot);
          dialog.querySelector('[data-action="details"]')?.focus();
        }
      }
    } catch (error) {
      if (error.conflicts && form.querySelector('[data-conflicts]')) {
        showScheduleConflicts(form, error.conflicts);
      } else {
        errorNote.textContent = error.message;
        errorNote.hidden = false;
      }
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

export function startWorkspace({ restore } = {}) {
  if (restore) loadSession();
  navigator.serviceWorker?.register('/push-worker.js').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restartLocationTracking();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) restartLocationTracking();
  });
  window.addEventListener('online', restartLocationTracking);
  window.addEventListener('offline', updateTracking);
  setInterval(tick, 1000);
  setInterval(() => {
    if (!pending && !observing && session?.actor) refresh().catch(() => {});
  }, 15000);
}
