import { availableShoots, fenceRadius, presenceAt, returnSite, shootSite } from './attendance-policy.js';
import { accessView } from './access-view.js';

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
const tickingTime = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit' });
const adminNav = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['team', 'Employees', 'users'],
  ['schedule', 'Schedule', 'calendar-days'],
  ['clients', 'Clients', 'contact-round'],
  ['approvals', 'Approvals', 'clipboard-check'],
  ['finances', 'Finances', 'wallet'],
  ['attendance', 'Attendance', 'clock-3'],
  ['notifications', 'Notifications', 'bell'],
];
const employeeNav = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['schedule', 'My Schedule', 'calendar-days'],
  ['work', 'Available Work', 'briefcase'],
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

const initialState = () => ({ office: null, employees: [], tasks: [], sessions: [], attendance: [], reminders: [], clients: [], requests: [], openWork: [], payments: [], expenses: [] });
let state = initialState();
let session = null;
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
const pendingRequests = () => state.requests.filter((item) => item.status === 'pending');
const shoots = () => state.tasks.filter((task) => task.category === 'Photo shoot');
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const money = (paise) => rupees.format(paise / 100);
const studioTimeInput = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });

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
      <span class="brand-mark">${icon('camera')}</span><span><strong>Concept</strong><small>Photography</small></span>
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
    <div class="sidebar-foot">${icon('aperture')}<div><strong>Concept Photography</strong><small>Studio workspace · IST</small></div></div>`;
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

function loginPage() {
  stopTracking();
  document.body.classList.add('signed-out');
  sidebar.innerHTML = '';
  topbar.innerHTML = '';
  const setup = session?.needsSetup;
  const usesToken = setup && session.requiresSetupToken;
  main.innerHTML = accessView({
    title: setup ? 'Set up your studio' : 'Sign in',
    description: setup ? 'Create the first admin account for Concept Photography.' : 'Use your company email and password.',
    content: `<form class="sign-in-fields" method="post" data-form="${setup ? 'bootstrap' : 'login'}">
      ${setup ? '<label>Admin name<input name="name" autocomplete="name" maxlength="100" placeholder="Full name" required></label>' : ''}
      <label>Email address
        <span class="auth-input">${icon('mail')}<input name="email" type="email" autocomplete="username" maxlength="254" placeholder="you@company.com" required></span>
      </label>
      <div class="auth-password">
        <label for="sign-in-password">Password</label>
        <span class="auth-input with-toggle">${icon('lock-keyhole')}
          <input id="sign-in-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}"
            maxlength="128" placeholder="${setup ? 'Create a password' : 'Enter your password'}"
            ${setup ? 'minlength="12" aria-describedby="password-hint"' : ''} required>
          <button type="button" class="password-toggle" data-password-toggle aria-controls="sign-in-password"
            aria-label="Show password" title="Show password">${icon('eye')}</button>
        </span>
        ${setup ? '<small id="password-hint">Use at least 12 characters.</small>' : ''}
      </div>
      ${usesToken ? '<label>Setup token<input name="setupToken" type="password" autocomplete="off" required></label>' : ''}
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn primary auth-submit"><span>${setup ? 'Create admin account' : 'Sign in'}</span>${icon('arrow-right')}</button>
    </form>
    ${setup ? '' : '<p class="auth-help">Need access or a password reset? <strong>Contact your studio admin.</strong></p>'}`,
  });
}

main.addEventListener('click', (event) => {
  const button = event.target.closest('[data-password-toggle]');
  if (!button) return;
  const field = document.getElementById(button.getAttribute('aria-controls'));
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  const label = visible ? 'Hide password' : 'Show password';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon(visible ? 'eye-off' : 'eye');
});

function priority(task) {
  return task.priority && !task.completed_at ? tag('Priority', 'peach') : '';
}

function scheduleRow(task) {
  const [symbol, tone] = categories[task.category];
  const owner = task.is_open ? 'Available for requests' : employee(task.employee_id)?.name;
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
  const income = shoots().reduce((sum, task) => sum + task.income_paise, 0);
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
    ${office?.maps_url ? externalLink(office.maps_url, 'Open in Google Maps') : ''}
  </div></section>`;
}

function externalLink(url, label) {
  return `<a class="text-link" href="${e(url)}" target="_blank" rel="noopener noreferrer">${label}${icon('external-link')}</a>`;
}

function dashboard() {
  const now = Date.now();
  const upcoming = state.tasks.filter((task) => !task.completed_at && task.start_at + task.estimate * 60_000 > now);
  const pendingCount = pendingRequests().length;
  const { received, outstanding, expenses, net } = manager() ? totals() : {};
  const displayedMetrics = manager()
    ? [['Employees', state.employees.filter((person) => !person.is_admin).length, 'users', 'peach'],
       ['Upcoming shoots', upcoming.filter((task) => task.category === 'Photo shoot').length, 'calendar-days', 'lavender'],
       ['Pending approvals', pendingCount, 'clipboard-check', 'sand'],
       ['Payments received', money(received), 'wallet', 'sage']]
    : [['Priority assignments', upcoming.filter((task) => task.priority).length, 'flag', 'peach'],
       ['Upcoming shoots', upcoming.filter((task) => task.category === 'Photo shoot').length, 'calendar-days', 'lavender'],
       ['Requests pending', pendingCount, 'clipboard-check', 'sand'],
       ['Completed work', state.tasks.filter((task) => task.completed_at).length, 'circle-check', 'sage']];
  return `
    ${heading(manager() ? 'Admin Dashboard' : 'My Dashboard', manager() ? 'Manage the studio’s people, shoots, and finances.' : 'Your assignments, requests, and attendance.', manager() ? actionButton('Schedule shoot', 'new-task', 'plus') : '')}
    <section class="hero" aria-label="Studio overview">
      <div class="hero-date">${icon('calendar-days')} ${studioDate.format(now)}</div>
      <h2>Welcome, ${e(actor().name.split(/\s+/)[0])}</h2>
      <p>${manager() ? 'Concept Photography studio overview' : 'Your Concept Photography schedule'}</p>
    </section>
    ${metrics(displayedMetrics)}
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>${manager() ? 'Upcoming schedule' : 'My priority schedule'}</h2><p>Assigned work appears first.</p></div>${viewLink('schedule', 'View schedule')}</div>
        ${upcoming.length ? upcoming.slice(0, 5).map(scheduleRow).join('') : empty(manager() ? 'No upcoming shoots or tasks. Schedule a shoot to get started.' : 'Your assigned shoots and tasks will appear here.')}
      </section>
      <div class="stack">${manager() ? officeCard() : clockCard()}
        ${manager() ? `<section class="panel">
          <div class="panel-head"><div><h2>Finance overview</h2><p>All transactions recorded to date</p></div>${viewLink('finances', 'View finances')}</div>
          <dl class="balance-list"><div><dt>Pending payments</dt><dd>${money(outstanding)}</dd></div>
          <div><dt>Expenses</dt><dd>${money(expenses)}</dd></div><div><dt>Cash profit</dt><dd>${money(net)}</dd></div></dl>
        </section>` : ''}
      </div>
    </div>`;
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
      <div><h2>Time Clock</h2><p>${actor() ? e(actor().name) : ''}</p></div>
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
      <p class="location-note">${icon('map-pin')}${canClock ? `GPS must verify you are within ${fenceRadius} m of the work site` : 'No check-in site is available. Ask your studio manager.'}</p>
      <p class="location-watch" id="location-watch" role="status" hidden></p>
      ${(shift?.site || last?.resume_pending) && !permissionGranted ? actionButton('Enable location tracking', 'enable-location', 'locate-fixed', 'secondary') : ''}
    </div>
    ${last ? `<div class="clock-summary">
      <div><small>${shift ? 'Clocked in at' : 'Last clock-out'}</small><strong>${shortDate.format(shiftTime)} · ${time(shiftTime)}</strong></div>
      <div><small>${shift ? 'Current shift' : 'Last shift'}</small><strong ${shift ? `data-shift-start="${shift.clock_in}"` : ''}>${duration((last.clock_out ?? Date.now()) - last.clock_in)}</strong></div>
    </div>` : ''}
    ${manager() || last?.resume_pending ? `<div class="clock-tools">
      ${manager() ? actionButton('Office location', 'office-location', 'settings', 'secondary') : ''}
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


function table(caption, columns, rows) {
  return `<div class="table-wrap" tabindex="0" aria-label="${caption}"><table><thead><tr>
    ${columns.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function teamPage() {
  const staff = state.employees.filter((person) => !person.is_admin);
  const rows = staff.map((person) => [
    `<div class="inline">${avatar(person)}<div><strong>${e(person.name)}</strong><small>${e(person.role)}</small></div></div>`,
    e(person.email),
    e(person.phone || '—'),
    person.has_login ? tag('Login set', 'sage') : tag('Credentials needed', 'sand'),
    shiftFor(person.id) ? tag('Clocked in', 'sage') : tag('Clocked out', 'neutral'),
    state.tasks.filter((task) => task.employee_id === person.id && !task.completed_at && !task.is_open).length,
    actionButton('Edit employee', 'edit-employee', 'pencil', 'secondary', person.id),
  ]);
  return `${heading('Employees', 'Manage employee profiles and sign-in credentials.', actionButton('Add employee', 'new-employee', 'user-plus'))}
    <section class="panel">${rows.length ? table('Employee directory', ['Employee', 'Sign-in email', 'Mobile', 'Credentials', 'Attendance', 'Open assignments', 'Actions'], rows) : empty('Add an employee to create their login and assign their first shoot.')}</section>`;
}

function schedulePage() {
  const now = Date.now();
  const filtered = state.tasks.filter((task) => {
    if (employeeFilter !== 'all' && (task.employee_id !== Number(employeeFilter) || task.is_open)) return false;
    if (scheduleFilter === 'today') return day(task.start_at) === day(now);
    if (scheduleFilter === 'upcoming') return !task.completed_at && task.start_at + task.estimate * 60_000 > now;
    if (scheduleFilter === 'completed') return Boolean(task.completed_at);
    return true;
  });
  const options = [['upcoming', 'Upcoming'], ['today', 'Today'], ['all', 'All work'], ['completed', 'Completed']];
  return `${heading(manager() ? 'Schedule' : 'My Schedule', manager() ? 'Review assignments, open shoots, and tracked work.' : 'Priority assignments are listed first. Times are in IST.', manager() ? actionButton('Schedule shoot', 'new-task', 'plus') : '')}
    <div class="filter-bar">
      ${options.map(([key, label]) => `<button type="button" class="filter ${key === scheduleFilter ? 'active' : ''}" data-action="schedule-filter" data-value="${key}" aria-pressed="${key === scheduleFilter}">${label}</button>`).join('')}
      ${manager() ? `<select id="schedule-employee" aria-label="Filter schedule by employee"><option value="all">All employees</option>
        ${state.employees.map((person) => `<option value="${person.id}" ${String(person.id) === employeeFilter ? 'selected' : ''}>${e(person.name)}</option>`).join('')}</select>` : ''}
    </div>
    ${filtered.length ? `<div class="task-grid">${filtered.map((task) => taskCard(task)).join('')}</div>` : `<section class="panel">${empty('No work matches this view.')}</section>`}`;
}

function workControls(task) {
  if ((manager() && task.employee_id !== actorId) || task.is_open) return '';
  if (task.category === 'Photo shoot') {
    const shift = shiftFor(actorId);
    const atShoot = shift?.site && JSON.parse(shift.site).taskId === task.id;
    if (atShoot) {
      const complete = task.completed_at ? '' : '<button type="button" class="btn secondary" data-action="task-timer" data-value="complete" data-id="' + task.id + '">Mark complete</button>';
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
    <button type="button" class="btn secondary" data-action="task-timer" data-value="complete" data-id="${task.id}">Mark complete</button>`;
}

function taskCard(task, inDialog = false) {
  const isShoot = task.category === 'Photo shoot';
  return `<article class="${inDialog ? '' : 'panel task-card'}">
    ${inDialog ? '' : `<div class="panel-head"><div><h2>${e(task.title)}</h2><p>${e(task.category)}</p></div>
      <div class="row-tags">${priority(task)}${taskStatus(task)}</div></div>`}
    <div class="task-details">
      ${manager() ? `<div class="inline">${icon('user-round')}${task.is_open ? 'Open to employee requests' : e(employee(task.employee_id)?.name)}</div>` : ''}
      <div class="inline">${icon('calendar-days')}${shortDate.format(task.start_at)} · ${time(task.start_at)} IST</div>
      <div class="inline">${icon('map-pin')}${e(task.location)} ${task.maps_url ? externalLink(task.maps_url, 'Map') : ''}</div>
      ${task.client_name ? `<div class="inline">${icon('contact-round')}${e(task.client_name)} · <a class="map-link" href="tel:${e(task.client_phone)}">${e(task.client_phone)}</a></div>` : ''}
      ${manager() && isShoot ? `<div class="inline">${icon('indian-rupee')}${money(task.income_paise)} expected income</div>` : ''}
    </div>
    <div class="task-times">
      <div><small>Scheduled duration</small><strong>${duration(task.estimate * 60_000)}</strong></div>
      <div><small>Time tracked</small><strong ${activeSession(task) ? `data-elapsed="${task.id}"` : ''}>${elapsed(task)}</strong></div>
    </div>
    <div class="card-actions">${workControls(task)}
      ${manager() && !task.completed_at ? actionButton('Edit schedule', 'edit-task', 'pencil', 'secondary', task.id) : ''}
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
  return `${heading('Approvals', 'Review requests to take on open work. Approval assigns the shoot to the employee.')}
    <section class="panel">${rows.length ? table('Work requests', ['Work', 'Employee', 'Request note', 'Requested', 'Status', 'Actions'], rows) : empty('Employee requests for open work will appear here.')}</section>`;
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
    const due = task.income_paise - paid;
    return [`<strong>${e(task.title)}</strong><small>${e(task.client_name || 'No client')}</small>`,
      money(task.income_paise), money(paid), money(due),
      due > 0 ? actionButton('Record payment', 'record-payment', 'plus', 'secondary', task.id) : tag('Settled', 'sage')];
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

function attendancePage() {
  return `${heading('Attendance', manager() ? 'Review clock events and GPS records across the team.' : 'Manage your clock-in and clock-out at the office or assigned shoots.')}
    <div class="dashboard-grid attendance-page">${clockCard()}<section class="panel">
      <div class="panel-head"><div><h2>${manager() ? 'Team attendance' : 'My attendance'}</h2></div></div>
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


const pages = {
  dashboard, team: teamPage, schedule: schedulePage, clients: clientsPage, approvals: approvalsPage,
  work: availableWorkPage, finances: financesPage, attendance: attendancePage, notifications: notificationsPage,
};

function render() {
  if (!actor()) return;
  document.body.classList.remove('signed-out');
  displayedDate = today();
  shownShootIds = shootIds();
  renderChrome();
  main.innerHTML = pages[page]();
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
  const shiftTime = document.querySelector('[data-shift-start]');
  if (shiftTime) shiftTime.textContent = duration(Date.now() - Number(shiftTime.dataset.shiftStart));
  const face = document.querySelector('#clock-face');
  if (face) {
    const now = Date.now();
    const parts = tickingTime.formatToParts(now);
    const period = parts.find((part) => part.type === 'dayPeriod').value;
    const digits = parts.filter((part) => part.type !== 'dayPeriod').map((part) => part.value).join('').trim();
    face.innerHTML = `${digits}<small>${period}</small>`;
    document.querySelector('#clock-date').textContent = studioDate.format(now) + ' · IST';
  }
  document.querySelectorAll('[data-elapsed]').forEach((element) => {
    const task = state.tasks.find((item) => item.id === Number(element.dataset.elapsed));
    if (task) element.textContent = elapsed(task);
  });
}

async function request(path, body) {
  const response = await fetch('/api/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401 && session?.actor && path !== 'login') {
      clearWorkspace({ actor: null, needsSetup: false });
    }
    throw new Error(payload.error);
  }
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
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const notice of items) {
    try {
      new Notification('Concept Photography · Work reminder', {
        body: `${notice.title} starts at ${time(notice.start_at)} IST.`,
        tag: 'concept-task-' + notice.task_id,
      });
    } catch {
      // The in-app reminder remains available when desktop alerts are unsupported.
    }
  }
}

function clearWorkspace(info) {
  refreshVersion++;
  loading = false;
  snapshot = undefined;
  state = initialState();
  actorId = undefined;
  session = info;
  clockTarget = '';
  employeeFilter = 'all';
  scheduleFilter = 'upcoming';
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
  session = await request('session');
  if (session.actor) {
    await refresh({ force: true });
  } else {
    clearWorkspace(session);
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
    <label class="full">Sign-in email<input name="email" type="email" autocomplete="off" required maxlength="254" value="${e(person?.email)}"></label>
    <label class="full">${needsPassword ? 'Password' : 'New password (optional)'}<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" ${needsPassword ? 'required' : ''}></label>
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

function taskForm(task) {
  const category = task?.category || 'Photo shoot';
  const isShoot = category === 'Photo shoot';
  const isOpen = Boolean(task?.is_open);
  const employees = state.employees.filter((person) => person.has_login || person.is_admin);
  const staff = employees.filter((person) => !person.is_admin);
  const selected = (isOpen ? null : task?.employee_id) ?? staff[0]?.id ?? actorId;
  const clientId = task?.client_id;
  openDialog(task ? 'Edit schedule' : 'Schedule shoot', 'Direct assignments are marked as priority on the employee’s schedule.', entryForm('tasks', `
    ${task ? `<input type="hidden" name="id" value="${task.id}"><input type="hidden" name="category" value="${e(category)}">` : ''}
    <label class="full">Shoot or task name<input name="title" required maxlength="100" value="${e(task?.title)}"></label>
    ${!task ? `<label>Work type<select name="category">${Object.keys(categories).map((name) => `<option>${name}</option>`).join('')}</select></label>` : ''}
    <label>Assignment<select name="assignment"><option value="assigned">Assign directly</option><option value="open" ${isOpen ? 'selected' : ''}>Open for employee requests</option></select></label>
    <label class="full assignee" ${isOpen ? 'hidden' : ''}>Assigned employee<select name="employeeId" required ${isOpen ? 'disabled' : ''}>
      ${[...staff, ...employees.filter((person) => person.is_admin)].map((person) => `<option value="${person.id}" ${person.id === selected ? 'selected' : ''}>${e(person.name)}</option>`).join('')}</select></label>
    <label>Scheduled date<input name="startDate" type="date" required value="${task ? day(task.start_at) : today()}"></label>
    <label>Scheduled time (IST)<input name="startTime" type="time" required value="${task ? studioTimeInput.format(task.start_at) : ''}"></label>
    <label>Duration in minutes<input name="estimate" type="number" required min="1" max="1440" value="${task?.estimate ?? 60}"></label>
    <label>Location name<input name="location" required maxlength="100" value="${e(task?.location)}"></label>
    <fieldset class="full shoot-fields" ${isShoot ? '' : 'hidden disabled'}><legend>Shoot and client details</legend>
      <div class="form-grid">
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
  openDialog(e(task.title), e(task.category), taskCard(task, true));
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

const savedMessages = {
  employees: 'Employee saved.', clients: 'Client saved.', tasks: 'Schedule saved.', office: 'Company location saved.',
  'work-requests': 'Request sent.', payments: 'Payment recorded.', expenses: 'Expense saved.',
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

function applyAction(button, path, body, message) {
  mutate(button, async () => {
    await request(path, body);
    await refresh({ force: true });
    if (message) showToast(message);
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || !actor()) return;
  const { action, value } = button.dataset;
  const id = Number(button.dataset.id);
  const task = () => state.tasks.find((item) => item.id === id);
  switch (action) {
    case 'menu':
      mobileMenu = !mobileMenu;
      sidebar.classList.toggle('open', mobileMenu);
      button.setAttribute('aria-expanded', String(mobileMenu));
      break;
    case 'sign-out':
      mutate(button, async () => {
        await request('logout', {});
        history.replaceState(null, '', location.pathname);
        clearWorkspace({ actor: null, needsSetup: false });
      });
      break;
    case 'close': dialog.close(); break;
    case 'details': taskDialog(task()); break;
    case 'new-employee': employeeForm(); break;
    case 'edit-employee': employeeForm(employee(id)); break;
    case 'new-client': clientForm(); break;
    case 'edit-client': clientForm(state.clients.find((client) => client.id === id)); break;
    case 'new-task': taskForm(); break;
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
        { start: 'Timer started.', pause: 'Timer paused.', complete: 'Work marked complete.' }[value]);
      break;
    case 'enable-location':
      mutate(button, async () => { await getLocation(); render(); });
      break;
    case 'cancel-return':
      applyAction(button, 'attendance', { shiftId: latestShift()?.id, action: 'cancel-return' }, 'Automatic return cancelled.');
      break;
    case 'read': applyAction(button, 'reminders/read', {}); break;
    case 'alerts':
      mutate(button, async () => {
        const permission = await Notification.requestPermission();
        render();
        showToast(permission === 'granted' ? 'Browser alerts enabled.' : 'Reminders are available in Notifications.');
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
  if (input.id === 'clock-target') clockTarget = input.value;
  if (input.id === 'schedule-employee') {
    employeeFilter = input.value;
    render();
    main.querySelector('#schedule-employee')?.focus();
  }
  const form = input.form;
  if (form?.dataset.form !== 'tasks') return;
  if (input.name === 'category') toggleFields(form.querySelector('.shoot-fields'), input.value === 'Photo shoot');
  if (input.name === 'clientId') toggleFields(form.querySelector('.owner-fields'), !input.value);
  if (input.name === 'assignment') {
    const direct = input.value !== 'open';
    form.querySelector('.assignee').hidden = !direct;
    form.elements.employeeId.disabled = !direct;
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
  const data = Object.fromEntries(new FormData(form));
  if (kind === 'tasks') data.startAt = `${data.startDate}T${data.startTime}:00+05:30`;
  const authLabel = form.querySelector('.auth-submit span');
  const originalLabel = authLabel?.textContent;
  mutate(event.submitter, async () => {
    if (authLabel) {
      form.setAttribute('aria-busy', 'true');
      authLabel.textContent = kind === 'login' ? 'Signing in…' : 'Creating account…';
    }
    try {
      await request(kind, data);
      if (kind === 'login' || kind === 'bootstrap') {
        await loadSession();
        return;
      }
      await refresh({ force: true });
      if (dialog.open) dialog.close();
      if (kind === 'tasks' && page !== 'schedule') location.hash = '#schedule';
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

loadSession().catch(() => {
  main.innerHTML = accessView({
    title: 'Workspace unavailable',
    description: 'The workspace could not load. Check your connection and try again.',
    content: '<a class="btn primary auth-submit" href="./">Try again</a>',
  });
});
setInterval(tick, 1000);
setInterval(() => {
  if (!pending && session?.actor) refresh().catch(() => {});
}, 15000);
