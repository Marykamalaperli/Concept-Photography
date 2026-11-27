import { createAuditViews } from './audit-views.js';
import { businessLabels, createScopedViews } from './scoped-views.js';
import { hasSavedDeparture, offlineWorkForms, prepareDepartureStorage } from './offline-queue.js';
import {
  additionalShootLocations, assignedTo, availableShoots, boundarySampleDelay, fenceRadius, maxAdditionalShootSites, maxFixAge, officeSites, presenceAt, returnSite, shootSites,
} from './attendance-policy.js';
import { createReviewViews } from './review-views.js';
import { createProjectViews } from './projects-views.js';
import { createRevenueViews } from './revenue-views.js';
import { createFootageViews } from './footage-views.js';
import { createWorksheetViews } from './worksheet-views.js';
import { createOperationsViews } from './operations-views.js';
import { loginView, passwordField, togglePassword, workspaceRequest } from './access-view.js';
import { cashReceiptComparison, financeCsv, financeGroups, financeReport, monthlyCashTrend } from './finance-report.js';
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
  ['footage', 'Footage storage', 'archive'],
  ['daily-plans', 'Daily plans', 'notebook-pen'],
  ['projects', 'Projects', 'folder-open'],
  ['clients', 'Clients', 'contact-round'],
  ['approvals', 'Approvals', 'clipboard-check'],
  ['reviews', 'Review queue', 'inbox'],
  ['finances', 'Finances', 'wallet'],
  ['attendance', 'Attendance', 'clock-3'],
  ['worksheet', 'Worksheets', 'notebook-pen'],
  ['leave', 'Leave & holidays', 'calendar-heart'],
  ['work-log', 'Work log', 'notebook-pen'],
  ['revenue', 'Revenue contribution', 'indian-rupee'],
  ['payroll', 'Payslips', 'receipt'],
  ['announcements', 'Announcements', 'megaphone'],
  ['notifications', 'Notifications', 'bell'],
  ['audit-history', 'Audit history', 'list'],
  ['settings', 'Settings', 'settings'],
];
const employeeNav = [
  ['dashboard', 'Dashboard', 'layout-dashboard'],
  ['schedule', 'My Schedule', 'calendar-days'],
  ['shoot-calendar', 'Shoot calendar', 'camera'],
  ['task-board', 'Tasks', 'columns-3'],
  ['footage', 'Footage storage', 'archive'],
  ['daily-plans', 'Daily plans', 'notebook-pen'],
  ['projects', 'Projects', 'folder-open'],
  ['work', 'Available Work', 'briefcase'],
  ['attendance', 'Attendance', 'clock-3'],
  ['worksheet', 'Worksheets', 'notebook-pen'],
  ['leave', 'Leave & holidays', 'calendar-heart'],
  ['work-log', 'Work log', 'notebook-pen'],
  ['revenue', 'Revenue contribution', 'indian-rupee'],
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
  projects: [], workPeriods: [], activeWorkPeriods: [], shiftReviews: [], footageChecks: [], revenueSummary: null, taskDrafts: [],
  plans: [], taskChanges: [], operationNotices: [], assignableStaff: [],
  holidays: [], hrRequests: [], workLogs: [], payslips: [], announcements: [], attendanceGaps: [],
  office: null, employees: [], tasks: [], sessions: [], attendance: [], reminders: [], clients: [], requests: [], openWork: [], payments: [], expenses: [] });
let state = initialState();
let session = null;
let sessionVersion = 0;
let snapshot;
let stateTag;
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
let offlineDeparture;
let profileNote;
let workSync;
const signOutMarker = 'concept-signout-pending';
let offlineStorage;
let offlineKeyCheck;
let syncingDeparture = false;
let shownShootIds = '';
let mobileDevice;
let checkedSite = '';
let locationCheck = '';
let clientSearch = '';
let clientPage = 0;
let financeMonth = '';

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const icon = (name) => `<i class="icon" aria-hidden="true" style="--icon:url('./icons/${name}.svg')"></i>`;
const tile = (name, color) => `<span class="tile ${color}">${icon(name)}</span>`;
const employee = (id) => state.employees.find((person) => person.id === id);
const actor = () => state.actor ?? employee(actorId);
const manager = () => Boolean(actor()?.is_admin);
const latestShift = () => state.attendance.find((shift) => shift.employee_id === actorId);
const checkInShoots = () => availableShoots(state.tasks.filter((task) => !task.is_open), actorId, Date.now(), state.hrSettings);
const shootIds = () => checkInShoots().map((task) => task.id).join(',');
const reminders = () => state.reminders.filter((notice) => notice.employee_id === actorId);
const shiftFor = (id) => state.attendance.find((shift) => shift.employee_id === id && shift.clock_out === null);
const sessionsFor = (task) => state.sessions.filter((session) => session.task_id === task.id);
const activeSession = (task) => sessionsFor(task).find((session) => session.end_at === null);
const time = (value) => studioTime.format(value);
const day = (value) => dateKey.format(value);
const today = () => day(Date.now());
const tag = (label, color) => `<span class="tag ${color}"><span class="dot"></span>${label}</span>`;

const nav = () => manager() ? adminNav : [
  ...employeeNav,
  ...(actor()?.permissions?.some((permission) => permission.startsWith('review-')) ? [['reviews', 'Review queue', 'inbox']] : []),
  ...(actor()?.permissions?.some((permission) => Object.hasOwn(businessLabels, permission)) ? [['scoped-work', 'Client and project desk', 'briefcase']] : []),
];
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
  return `<span class="avatar ${e(person.color)}" aria-hidden="true">${e(letters)}
    ${person.active_photo_id ? `<img class="avatar-photo" src="/api/avatars/${person.id}/${e(person.active_photo_id)}" alt="" width="38" height="38">` : ''}</span>`;
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
  if (task.work_state === 'reschedule') return tag('Needs rescheduling', 'sand');
  if (task.work_state === 'review') return tag('In review', 'lavender');
  if (task.blocked_reason) return tag('Blocked', 'peach');
  if (task.is_open) return tag('Open for requests', 'sand');
  if (task.completed_at) return tag('Completed', 'sage');
  if (activeSession(task)) return tag('In progress', 'lavender');
  if (sessionsFor(task).length) return tag('Paused', 'sand');
  return tag(task.is_unscheduled ? 'Unscheduled' : 'Scheduled', 'neutral');
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
  const unread = [...reminders(), ...state.operationNotices].filter((notice) => !notice.read_at).length;
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
      <span class="connection-status" aria-live="polite" ${navigator.onLine ? 'hidden' : ''}>Offline</span>
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
  return task.priority && !task.completed_at ? tag(task.emergency ? 'Emergency' : 'Priority', 'peach') : '';
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
      <p>${office ? e(office.name) + ' · ' + (office.radius ?? fenceRadius) + ' m attendance boundary' : 'Set the office coordinates to enable attendance.'}</p></div></div>
  </div>
  <div class="card-actions">${actionButton(office ? 'Edit location' : 'Set company location', 'office-location', 'map-pin', 'secondary')}
    ${mapLink(office)}
  </div>
  ${officeSites(office).length > 1 ? `<ul class="office-pins">${officeSites(office).slice(1).map((site) =>
    `<li>${e(site.name)} ${mapLink(site)}</li>`).join('')}</ul>` : ''}</section>`;
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
  const date = today();
  const month = date.slice(0, 7);
  const openTasks = state.tasks.filter((task) => task.shoot_status === 'booked' && !task.completed_at);
  const upcoming = openTasks.filter((task) => !task.is_unscheduled && task.start_at + task.estimate * 60_000 > now);
  const { outstanding } = totals();
  const received = state.payments.reduce((sum, item) => sum + (item.paid_on.startsWith(month) ? item.amount_paise : 0), 0);
  const expenses = state.expenses.reduce((sum, item) => sum + (item.spent_on.startsWith(month) ? item.amount_paise : 0), 0);
  const staff = state.employees.filter((person) => !person.is_admin && !person.deactivated);
  const active = staff.flatMap((person) => {
    const shift = shiftFor(person.id);
    const period = state.activeWorkPeriods.find((item) => item.employee_id === person.id);
    if (!shift && !period) return [];
    const activeSite = shift?.site && JSON.parse(shift.site);
    const gap = shift && state.attendanceGaps.some((item) => item.attendance_id === shift.id && item.resolved_at === null);
    const status = period ? { travel: 'Travelling', lunch: 'At lunch', personal: 'On a break' }[period.kind] :
      activeSite?.taskId ? 'On a shoot' : 'Working';
    return [`<div><dt>${e(person.name)}</dt><dd>${status}${gap ? ' · GPS unverified' : ''}</dd></div>`];
  });
  const dueToday = openTasks.filter((task) => task.is_unscheduled || day(task.start_at) === date);
  const assigned = new Set(dueToday.flatMap((task) => [task.employee_id, ...(task.crew ?? []).map((person) => person.employee_id)]));
  const todayOff = new Date(date + 'T12:00:00+05:30').getUTCDay() === state.hrSettings.week_off ||
    state.holidays.some((holiday) => holiday.day === date);
  const unassigned = todayOff ? [] : staff.filter((person) => person.has_login && !assigned.has(person.id) &&
    (!person.employment_start || person.employment_start <= date) && !state.hrRequests.some((item) =>
      item.employee_id === person.id && item.kind === 'leave' && item.status === 'approved' &&
      item.leave_type !== 'half' && item.day_from <= date && item.day_to >= date));
  const queue = [
    ['GPS verification interruptions', state.attendanceGaps.filter((item) => item.resolved_at === null).length, 'attendance'],
    ['Shifts below required hours awaiting review', state.shiftReviews.filter((item) => item.status === 'pending' && item.recorded_ms < item.required_ms).length, 'reviews'],
    ['Employees without work today', unassigned.length, 'schedule'],
    ['Daily plans awaiting review', state.plans.filter((item) => item.status === 'submitted').length, 'reviews'],
    ['Overdue tasks', openTasks.filter((item) => item.category !== 'Photo shoot' && item.work_state === 'ready' && !item.is_unscheduled &&
      item.start_at + item.estimate * 60_000 < now).length, 'task-board'],
    ['Emergency shoots', upcoming.filter((item) => item.emergency).length, 'shoot-calendar'],
    ['Work, leave and time requests', pendingRequests().length, 'approvals'],
    ['Next-day plans past deadline', state.missingNextPlans ?? 0, 'daily-plans'],
    ['Pending footage checks', state.footageChecks.filter((item) => item.status !== 'approved').length, 'footage'],
  ];
  return `
    ${heading('Admin Dashboard', 'Manage the studio’s people, shoots, and finances.', actionButton('Schedule shoot', 'new-shoot', 'plus'))}
    <p class="dashboard-date">${studioDate.format(now)}</p>
    ${metrics([
      ['Employees on duty', active.length, 'users', 'peach'],
      ['Upcoming shoots', upcoming.filter((task) => task.category === 'Photo shoot').length, 'calendar-days', 'lavender'],
      ['Plans awaiting review', queue[3][1], 'clipboard-check', 'sand'],
      ['Receipts this month', money(received), 'wallet', 'sage'],
    ])}
    <div class="dashboard-grid">
      <div class="stack">
      <section class="panel">
        <div class="panel-head"><div><h2>Needs attention</h2></div></div>
        ${queue.some(([, count]) => count) ? `<dl class="balance-list dashboard-queues">${queue.filter(([, count]) => count)
          .map(([label, count, route]) => `<div><dt>${viewLink(route, label)}</dt><dd>${count}</dd></div>`).join('')}</dl>` : empty('No operational issues to review.')}
        ${unassigned.length ? `<p class="dashboard-names">${e(unassigned.slice(0, 6).map((person) => person.name).join(', '))}${unassigned.length > 6 ? ' and ' + (unassigned.length - 6) + ' more' : ''}</p>` : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Upcoming schedule</h2><p>Assigned work appears first.</p></div>${viewLink('schedule', 'View schedule')}</div>
        ${upcoming.length ? upcoming.slice(0, 5).map(scheduleRow).join('') : empty('No upcoming shoots or tasks.')}
      </section>
      </div>
      <div class="stack">
        <section class="panel"><div class="panel-head"><h2>On duty</h2>${viewLink('attendance', 'Attendance')}</div>
          ${active.length ? `<dl class="balance-list">${active.join('')}</dl>` : empty('No employees are checked in or travelling.')}
        </section>
        <section class="panel">
          <div class="panel-head"><div><h2>Finance overview</h2><p>${new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now)}</p></div>${viewLink('finances', 'View finances')}</div>
          <dl class="balance-list"><div><dt>Receipts this month</dt><dd>${money(received)}</dd></div>
          <div><dt>Expenses this month</dt><dd>${money(expenses)}</dd></div>
          <div><dt>Cash profit or loss this month</dt><dd>${money(received - expenses)}</dd></div>
          <div><dt>Outstanding client payments</dt><dd>${money(outstanding)}</dd></div></dl>
        </section>
        ${officeCard()}
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
          ${state.office ? '<option value="">' + e(officeSites(state.office).length > 1 ? 'Office locations' : state.office.name) + '</option>' : ''}
          ${sites.map((task) => {
            const count = shootSites(task).length;
            return `<option value="${task.id}" ${String(task.id) === clockTarget ? 'selected' : ''}>${e(task.title)} · ${count > 1 ? `${count} locations` : e(task.location)}</option>`;
          }).join('')}
        </select></label>` : ''}
      ${(shift || !sites.length) && boundSite ? `<p class="hr-clock-site">${icon('map-pin')}${e(boundSite.name)}</p>` : ''}
      ${offlineDeparture ? `<p class="location-watch" role="status">${offlineDeparture.error ? e(offlineDeparture.error) :
        offlineDeparture.encrypted ? 'Departure saved on this device. It will be sent when this account reconnects.' :
        'Departure queued. Keep this tab open until your report is sent.'}</p>
        ${offlineDeparture.error ? actionButton('Discard queued request', 'discard-offline-departure', 'x', 'secondary') : ''}` :
        `<div class="hr-clock-buttons">${clockButton('Check in', 'log-in', canClockIn)}${clockButton('Check out', 'log-out', canClockOut)}</div>
        ${worksheetViews.clockDetails(shift, last)}`}
      ${officeHours ? `<p class="hr-muted">${officeHours}</p>` : ''}
      <p class="hr-muted">${canClockIn || canClockOut ? 'A verified GPS reading is required.' : 'No check-in site is available.'}</p>
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
        shift.out_reason === 'account-deactivated' ? ' · Account deactivated' :
          shift.out_reason === 'employee-reported' ? ' · Employee reported' :
          shift.out_reason === 'offline-reported' ? ' · Offline report' : ''}</small>` : '—'}</td>
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
    `<div class="card-actions">${actionButton('Edit employee', 'edit-employee', 'pencil', 'secondary', person.id)}
      ${actionButton('Access role', 'assign-access-role', 'shield', 'secondary', person.id)}
      ${actionButton('Client and project access', 'scope-access', 'folder-lock', 'secondary', person.id)}
      ${actionButton('Profile photos', 'profile-files', 'image', 'secondary', person.id)}</div>`,
  ]);
  return `${heading('Employees', 'Manage profiles and sign-in credentials.', `<div class="card-actions">
     ${actionButton('Role permissions', 'role-permissions', 'shield', 'secondary')}
    ${actionButton('Access history', 'access-audit', 'list', 'secondary')}${actionButton('Add employee', 'new-employee', 'user-plus')}</div>`)}
    <section class="panel">${rows.length ? table('Employee directory', ['Employee', 'Sign-in email', 'Mobile', 'Credentials', ...(state.calendarFeeds ? ['Calendar'] : []), 'Attendance', 'Open assignments', 'Actions'], rows) : empty('Add an employee to create their login and assign their first shoot.')}</section>`;
}

function schedulePage() {
  const now = Date.now();
  const filtered = state.tasks.filter((task) => {
    if (employeeFilter !== 'all' && !assignedTo(task, Number(employeeFilter))) return false;
    if (task.is_unscheduled && ['today','upcoming'].includes(scheduleFilter)) return false;
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
  if (!assignedTo(task, actorId) || task.shoot_status !== 'booked' || task.work_state !== 'ready' || task.completed_at) return '';
  if (task.category !== 'Photo shoot' && !task.acknowledged_at) {
    return `<button type="button" class="btn primary" data-action="task-timer" data-value="acknowledge" data-id="${task.id}">Acknowledge task</button>`;
  }
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
    ${task.footage_id ? viewLink('footage', 'Open footage verification') : ''}
    ${!task.footage_id && sessionsFor(task).some((session) => session.employee_id === actorId) ? actionButton('Submit work for review', 'submit-completion', 'send', 'secondary', task.id) : ''}
    ${!task.footage_id ? actionButton('Progress and draft', 'task-draft', 'pencil', 'secondary', task.id) : ''}
    ${!task.footage_id ? actionButton('Block task', 'block-task', 'octagon-alert', 'secondary', task.id) : ''}`;
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
      <div class="inline">${icon('calendar-days')}${task.is_unscheduled ? 'Unscheduled' : task.shoot_status === 'postponed' ? 'Awaiting a new date' :
        `${shortDate.format(task.start_at)} · ${time(task.start_at)}${isShoot || task.parent_shoot_id ? ` – ${shootEndLabel(task)}` : ''} IST`}</div>
      ${sites.length > 1 ? `<div class="shoot-site-list"><strong>Shoot locations</strong><ul>
        ${sites.map((site) => `<li class="inline">${icon('map-pin')}<span>${e(site.name)}</span> ${mapLink(site, true)}</li>`).join('')}
      </ul></div>` : `<div class="inline">${icon('map-pin')}${e(task.location)} ${mapLink(sites[0])}</div>`}
      ${task.project_id ? `<div class="inline">${actionButton('View project', 'project-detail', 'folder-open', 'secondary', task.project_id)}</div>` : ''}
      ${task.footage_status ? `<div class="inline">${icon('archive')}<span>Footage · ${e(footageViews.label(task.footage_status))}</span></div>` : ''}
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
    ${task.completion_file_id ? `<p><a class="text-link" href="/api/files/${e(task.completion_file_id)}">Download completion evidence</a></p>` : ''}
    ${task.completion_report ? `<p class="hr-task-note"><strong>Completion report</strong><br>${e(task.completion_report)}</p>` : ''}
    <div class="card-actions">${workControls(task)}
      ${!task.is_open ? actionButton('Task files', 'task-files', 'paperclip', 'secondary', task.id) : ''}
      ${!isShoot && !task.footage_id && !task.is_open && !task.completed_at && task.shoot_status === 'booked' && task.work_state !== 'review'
        ? actionButton('Request task change', 'task-change', 'calendar-days', 'secondary', task.id) : ''}
      ${manager() && task.work_state === 'review' && !task.footage_id ? actionButton('Approve completion', 'task-completion-approve', 'check', 'primary', task.id) +
        actionButton('Return task', 'task-completion-return', 'arrow-left', 'secondary', task.id) : ''}
      ${manager() && !task.footage_id && (isShoot || (!task.completed_at && !task.daily_plan_id && task.work_state === 'ready')) ? actionButton('Edit schedule', 'edit-task', 'pencil', 'secondary', task.id) : ''}
      ${manager() && isShoot && task.completed_at ? actionButton('Allocate revenue', 'allocate-revenue', 'indian-rupee', 'secondary', task.id) : ''}
      ${manager() && isShoot && task.completed_at && !editing ? actionButton('Schedule editing', 'schedule-editing', 'calendar-plus', 'primary', task.id) : ''}
      ${manager() && isShoot && !task.completed_at && !task.is_open && task.shoot_status === 'booked'
        ? actionButton('Mark shoot done', 'shoot-done', 'circle-check', 'secondary', task.id) : ''}
    </div>
  </article>`;
}

function clientsPage() {
  const query = clientSearch.toLowerCase();
  const matches = state.clients.filter((client) => !query || [client.name, client.phone, client.email, client.category]
    .some((value) => value?.toLowerCase().includes(query)));
  const pageSize = 30;
  const last = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  clientPage = Math.min(clientPage, last);
  const rows = matches.slice(clientPage * pageSize, (clientPage + 1) * pageSize).map((client) => [
    `<strong>${e(client.name)}</strong>`, `<a class="map-link" href="tel:${e(client.phone)}">${e(client.phone)}</a>`,
    e(client.email || '—'), e(client.category || '—'), e(client.postal_address || '—'), e(client.notes || '—'),
    shoots().filter((task) => task.client_id === client.id).length,
    (() => {
      const checks = state.footageChecks.filter((row) => row.client_id === client.id);
      return checks.length ? checks.filter((row) => row.status === 'approved').length + ' / ' + checks.length + ' verified' : '—';
    })(),
    `<div class="card-actions">${actionButton('Edit client', 'edit-client', 'pencil', 'secondary', client.id)}
      ${actionButton('Client files', 'client-files', 'paperclip', 'secondary', client.id)}</div>`,
  ]);
  return `${heading('Clients', 'Find the owners, contacts, and notes for your shoots.', actionButton('Add client', 'new-client', 'user-plus'))}
    <section class="panel"><div class="operation-toolbar"><label>Search clients<input type="search" id="client-search" value="${e(clientSearch)}" placeholder="Name, mobile, email or category"></label></div>
      ${rows.length ? table('Clients', ['Client', 'Mobile', 'Email', 'Category', 'Address', 'Notes', 'Shoots', 'Footage', 'Actions'], rows) +
        (last ? `<div class="card-actions"><span>${clientPage * pageSize + 1}–${Math.min(matches.length, (clientPage + 1) * pageSize)} of ${matches.length}</span>
          ${clientPage > 0 ? actionButton('Previous clients', 'previous-clients', 'arrow-left', 'secondary') : ''}
          ${clientPage < last ? actionButton('Next clients', 'next-clients', 'arrow-right', 'secondary') : ''}</div>` : '') :
        empty(clientSearch ? 'No clients match your search.' : 'Add a client here or enter their details when scheduling a shoot.')}</section>`;
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
    ${hrViews.approvals()}
    ${worksheetViews.reviewTable(state.shiftReviews, true)}
    <section class="panel"><div class="panel-head"><h2>Task completion reviews</h2></div>
    ${state.tasks.some((task) => task.work_state === 'review' && !task.footage_id) ? state.tasks.filter((task) => task.work_state === 'review' && !task.footage_id)
      .map((task) => `<div class="notice-row"><strong>${e(task.title)}</strong>${actionButton('Review task', 'details', 'arrow-right', 'secondary', task.id)}</div>`).join('')
      : empty('No tasks awaiting completion review.')}
    <p>${viewLink('daily-plans', 'Daily plans and task changes')}</p></section>`;
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
  const period = financeMonth.length === 4 ? financeMonth : financeMonth ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: zone })
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
    e(state.tasks.find((task) => task.id === entry.task_id)?.title), money(entry.amount_paise), e(entry.category || 'Shoot payment'), e(entry.note || '—'),
    actionButton('Edit payment', 'edit-payment', 'pencil', 'secondary', entry.id)]);
  const expenseRows = report.expenses.map((entry) => [e(entry.spent_on), e(entry.name), e(entry.category), money(entry.amount_paise), e(entry.note || '—'),
    `<div class="card-actions">${actionButton('Edit expense', 'edit-expense', 'pencil', 'secondary', entry.id)}
      ${actionButton('Receipts', 'expense-files', 'paperclip', 'secondary', entry.id)}</div>`]);
  return `<div id="finance-print">${heading('Finances', 'Track shoot income, payments, and studio expenses in INR.', actionButton('Add expense', 'add-expense', 'plus'))}
    <section class="panel finance-toolbar" aria-label="Finance report filters">
      <div><h2>${period}</h2><p>Payments and expenses use the date they were recorded against. Shoot balances use the scheduled shoot date.</p></div>
      <div class="finance-actions"><label>Report month<input type="month" id="finance-month" value="${e(financeMonth.length === 7 ? financeMonth : '')}" placeholder="YYYY-MM"></label>
        <label>Report year<input type="number" inputmode="numeric" id="finance-year" min="1900" max="9999"
          value="${financeMonth.length === 4 ? e(financeMonth) : ''}" placeholder="YYYY"></label>
        ${financeMonth ? actionButton('All time', 'finance-clear', 'calendar-days', 'secondary') : ''}
        ${actionButton('Export CSV', 'export-finance', 'download', 'secondary')}
        ${actionButton('Print or save PDF', 'print-finance', 'printer', 'secondary')}</div>
    </section>
    ${metrics([['Expected shoot income', money(report.expected), 'indian-rupee', 'lavender'],
      ['Payments received', money(report.received), 'wallet', 'sage'], ['Pending for these shoots', money(report.outstanding), 'hourglass', 'sand'],
      ['Expenses', money(report.spent), 'receipt', 'peach']])}
    <section class="panel net-panel"><div><h2>Cash profit ${financeMonth ? 'for this period' : 'to date'}</h2><p>Payments received less expenses recorded${report.received
      ? ` · ${new Intl.NumberFormat('en-IN', { style: 'percent', maximumFractionDigits: 1 }).format(report.net / report.received)} cash margin` : ''}</p></div><strong>${money(report.net)}</strong></section>
    ${cashTrendPanel()}
    ${cashGrowthPanel()}
    <div class="finance-breakdowns">${financeGroups(report, state.tasks, state.projects).map(([label, rows]) => `<section class="panel">
      <div class="panel-head"><h2>${label}</h2></div>
      ${rows.length ? table(label, ['Name', 'Total'], rows.map(([name, total]) => [e(name), money(total)])) : empty('No transactions in this period.')}
    </section>`).join('')}</div>
    <section class="panel finance-table"><div class="panel-head"><div><h2>Overdue payments</h2><p>Unpaid balances with a due date before today, across all shoots.</p></div>
      ${overdueRows.length ? tag(money(report.overdue.reduce((sum, entry) => sum + entry.pending, 0)) + ' overdue', 'sand') : ''}</div>
      ${overdueRows.length ? table('Overdue payments', ['Shoot', 'Due date', 'Outstanding', 'Actions'], overdueRows) : empty('No overdue payments.')}</section>
    <section class="panel finance-table"><div class="panel-head"><div><h2>Shoot balances</h2><p>Balances include all payments made against each shoot.</p></div></div>
      ${rows.length ? table('Shoot balances', ['Shoot', 'Expected', 'Received', 'Pending', 'Due date', 'Actions'], rows) : empty('No shoots in this period.')}</section>
    <div class="dashboard-grid ledger-panels">
      <section class="panel"><div class="panel-head"><div><h2>Payment history</h2></div></div>
        ${paymentRows.length ? table('Payments', ['Date', 'Shoot', 'Amount', 'Category', 'Reference', 'Actions'], paymentRows) : empty('No payments recorded.')}</section>
      <section class="panel expense-ledger"><div class="panel-head"><div><h2>Expense history</h2></div></div>
        ${expenseRows.length ? table('Expenses', ['Date', 'Expense', 'Category', 'Amount', 'Notes', 'Actions'], expenseRows) : empty('No expenses recorded.')}</section>
    </div></div>`;
}

function cashTrendPanel() {
  const trend = monthlyCashTrend(state.payments, state.expenses, (financeMonth.length === 4 ? financeMonth + '-12' : financeMonth) || today().slice(0, 7));
  const scale = Math.max(0, ...trend.map(({ received, spent }) => Math.max(received, spent)));
  const label = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `<section class="panel finance-table">
    <div class="panel-head"><div><h2>Cash trend</h2><p>Receipts, expenses, and net cash over six months.</p></div></div>
    ${scale ? `<div class="cash-trend">${trend.map(({ period, received, spent, net }) =>
      `<div class="cash-month"><strong>${label.format(Date.parse(period + '-01T12:00:00Z'))}</strong>
        <div class="cash-month-values">
          <span class="cash-value"><span>Received ${money(received)}</span><i class="cash-bar received" aria-hidden="true" style="--share:${received / scale * 100}%"></i></span>
          <span class="cash-value"><span>Expenses ${money(spent)}</span><i class="cash-bar spent" aria-hidden="true" style="--share:${spent / scale * 100}%"></i></span>
          <span class="cash-value"><span>Profit or loss ${money(net)}</span><i class="cash-bar ${net < 0 ? 'spent' : 'received'}" aria-hidden="true" style="--share:${Math.abs(net) / scale * 100}%"></i></span>
        </div>
      </div>`).join('')}</div>` : empty('No receipts or expenses in these six months.')}
  </section>`;
}

function cashGrowthPanel() {
  const comparison = cashReceiptComparison(state.payments, financeMonth, today());
  if (!comparison) return '';
  const { currentPeriod, previousPeriod, current, previous, ongoing, growth } = comparison;
  const format = (period) => period.length === 4 ? period : new Intl.DateTimeFormat('en-IN', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(period + '-01T12:00:00Z'));
  const change = growth == null ? '—' : new Intl.NumberFormat('en-IN', {
    style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
  }).format(growth);
  return `<section class="panel finance-table">
    <div class="panel-head"><div><h2>Receipt growth</h2>${ongoing ? '<p>Periods are compared through the same elapsed date.</p>' : ''}</div></div>
    <dl class="worksheet-totals">
      <div><dt>${format(currentPeriod)}</dt><dd>${money(current)}</dd></div>
      <div><dt>${format(previousPeriod)}</dt><dd>${money(previous)}</dd></div>
      <div><dt>Change in receipts</dt><dd>${change}</dd></div>
    </dl>
    ${growth == null ? '<p class="hr-muted">The previous period has no receipts to compare.</p>' : ''}
  </section>`;
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
    description: mobileDevice.updatesEnabled ? 'Schedule reminders and work updates are enabled on this device.' :
      'Schedule reminders are enabled. You can also receive assignment, task and review updates.',
    action: actionButton(mobileDevice.updatesEnabled ? 'Turn off work updates' : 'Turn on work updates', 'toggle-work-updates',
      mobileDevice.updatesEnabled ? 'bell-off' : 'bell', 'secondary') +
      actionButton('Disable mobile alerts', 'disable-alerts', 'bell-off', 'secondary'),
  };
  return {
    description: 'Enable alerts on this device to receive work reminders 30 minutes before the scheduled start.',
    action: actionButton('Enable mobile alerts', 'enable-alerts', 'bell', 'secondary'),
  };
}

function locationCheckSites() {
  const sites = new Map();
  const key = (site) => `${site.taskId ?? 'office'}:${site.latitude},${site.longitude}`;
  const bound = trackingTarget()?.site;
  if (bound) sites.set(key(bound), bound);
  for (const site of officeSites(state.office)) {
    if (!sites.has(key(site))) sites.set(key(site), site);
  }
  for (const task of state.tasks) {
    if (assignedTo(task, actorId) && task.shoot_status === 'booked' && !task.completed_at && task.start_at + task.estimate * 60_000 > Date.now()) {
      for (const site of shootSites(task, state.hrSettings)) {
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
    Object.assign(device, { registration, key: key.publicKey, enabled: status.enabled, updatesEnabled: status.updatesEnabled });
  } catch {
    device.error = true;
  }
  if (mobileDevice === device && page === 'notifications' && actor()) render();
}

function notificationsPage() {
  const notices = reminders();
  const operations = state.operationNotices;
  const mobile = mobileAlertControls();
  return `${heading('Notifications', 'Reminders for your assigned work.')}
    ${deviceChecks(mobile)}
    <section class="panel">
      <div class="panel-head"><div><h2>${actor() ? `Reminders for ${e(actor().name)}` : 'Work reminders'}</h2></div>
      ${[...notices, ...operations].some((notice) => !notice.read_at) ? actionButton('Mark all read', 'read', 'check-check', 'secondary') : ''}</div>
      ${notices.length ? notices.map((notice) => `<div class="notice-row">
        ${tile('bell', 'peach')}<div><h3>${e(notice.title)}</h3>
        <p>Scheduled for ${shortDate.format(notice.start_at)} at ${time(notice.start_at)} IST</p></div>${notice.read_at ? '' : tag('Unread', 'peach')}
      </div>`).join('') : empty('No reminders yet.')}
    </section>
    <section class="panel"><div class="panel-head"><h2>Assignments and approvals</h2></div>
      ${operations.length ? operations.map((notice) => {
        const task = state.tasks.find((item) => item.id === notice.task_id);
        const canChange = task && task.category !== 'Photo shoot' && !task.completed_at && task.work_state !== 'review';
        return `<div class="notice-row">${tile('bell', 'peach')}<div><h3>${e(notice.title)}</h3>
          <p>${e(notice.message)}</p><p>${shortDate.format(notice.created_at)} · ${time(notice.created_at)} IST</p></div>
          <div class="card-actions">${notice.read_at ? '' : tag('Unread', 'peach')}
            ${canChange && notice.title === 'Task finishes soon' ? actionButton('Request time extension', 'task-change', 'clock-3', 'secondary', task.id) :
              task ? actionButton('View task', 'details', 'arrow-right', 'secondary', task.id) : ''}</div></div>`;
      }).join('') : empty('No assignment or approval notifications yet.')}
    </section>`;
}

const operationsViews = createOperationsViews({
  actor, state: () => state, manager, e, actionButton, heading, openDialog, entryForm, empty, applyAction, time, today,
});

const reviewViews = createReviewViews({
  actor, e, employee, heading, actionButton, openDialog, entryForm, empty, day, time, duration, request, mutate, render,
});

const projectViews = createProjectViews({
  state: () => state, manager, e, actionButton, heading, entryForm, openDialog, empty, table, day, time, money, applyAction, request, mutate,
});

const auditViews = createAuditViews({ e, heading, actionButton, entryForm, empty, table, request, mutate, render, timeInput: studioDateTimeInput, state: () => state });

const scopedViews = createScopedViews({
  actor, state: () => state, e, icon, heading, actionButton, entryForm, openDialog, table, empty, request, mutate, timeInput: studioDateTimeInput,
  render, clientForm, projectForm: projectViews.form,
});

const revenueViews = createRevenueViews({
  actor, state: () => state, manager, e, actionButton, heading, openDialog, entryForm, empty, day, today, table, money, duration, render,
});

const footageViews = createFootageViews({
  actor, state: () => state, manager, e, actionButton, heading, openDialog, entryForm, empty, day, time, tag,
});

const worksheetViews = createWorksheetViews({
  actor, state: () => state, manager, e, actionButton, heading, openDialog, entryForm, empty, applyAction, time, today, day, table, duration, money, render,
  availableTravel: () => shoots().filter((task) => assignedTo(task, actorId) && !task.completed_at && !task.is_open && task.shoot_status === 'booked'),
});

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

function settingsPage() {
  const settings = state.hrSettings;
  return `${heading('Settings', 'Manage studio policies, locations and the tools used to run the office.')}
    <dl class="settings-register panel">
      <div><dt>Office locations</dt><dd>${state.office ? e(state.office.name) : 'Office coordinates pending'}</dd>
      <dd>${actionButton('Edit office locations', 'office-location', 'map-pin', 'secondary')}</dd></div>
      <div><dt>Working hours, GPS and approvals</dt><dd>${settings.required_minutes} minutes per day · ${settings.boundary_samples} GPS confirmations</dd>
      <dd>${actionButton('Edit policy', 'hr-settings', 'settings', 'secondary')} ${actionButton('Policy history', 'policy-history', 'history', 'secondary')}</dd></div>
      <div><dt>Holidays and leave</dt><dd>Manage the studio holiday calendar and leave allowance.</dd>
        <dd>${viewLink('leave', 'Open leave and holidays')}</dd></div>
      <div><dt>Roles and notifications</dt><dd>Grant capabilities by role. Staff choose mobile updates per device.</dd>
        <dd>${actionButton('Role permissions', 'role-permissions', 'shield', 'secondary')} ${viewLink('notifications', 'Device notifications')}</dd></div>
      <div><dt>Footage storage</dt><dd>Assign the employee responsible for verifying shoot storage.</dd>
        <dd>${viewLink('footage', 'Open footage storage')}</dd></div>
      <div><dt>Retention and backup</dt><dd>Retention periods, backup destinations and HTTPS are configured on the office server.</dd>
        <dd>${viewLink('audit-history', 'Open audit history')}</dd></div>
    </dl>`;
}

const pages = {
  dashboard, 'daily-plans': operationsViews.plansPage, footage: footageViews.page, revenue: revenueViews.page, projects: projectViews.page, worksheet: worksheetViews.page, reviews: reviewViews.page, settings: settingsPage, 'audit-history': auditViews.page, 'scoped-work': scopedViews.page, team: teamPage, schedule: schedulePage, 'shoot-calendar': () => hrViews.shootCalendar(),
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
  main.innerHTML = workQueueBanner() + pages[page]();
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

async function request(path, body, tag) {
  try {
    return await workspaceRequest(path, body, tag);
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
  stateTag = undefined;
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
  operationsViews.reset();
  worksheetViews.reset();
  revenueViews.reset();
  projectViews.reset();
  scopedViews.reset();
  auditViews.reset();
  reviewViews.reset();
  offlineDeparture = undefined;
  offlineStorage = undefined;
  offlineKeyCheck = undefined;
  profileNote = undefined;
  workSync = undefined;
  clientSearch = '';
  clientPage = 0;
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
    const [response] = await Promise.all([request('state', undefined, force ? undefined : stateTag), loadHrViews()]);
    if (version !== refreshVersion || response === null) return;
    const { data: fresh, tag } = response;
    stateTag = tag;
    if (actor()?.scope_revision !== fresh.actor.scope_revision ||
        JSON.stringify(actor()?.permissions ?? []) !== JSON.stringify(fresh.actor.permissions ?? [])) {
      reviewViews.reset();
      scopedViews.reset();
    }
    session = { actor: fresh.actor };
    const fingerprint = tag ?? JSON.stringify(fresh);
    if (snapshot === fingerprint && !force) return;
    const oldIds = new Set(reminders().map((notice) => notice.task_id));
    const first = snapshot === undefined;
    snapshot = fingerprint;
    state = { ...initialState(), ...fresh };
    actorId = fresh.actor.id;
    if (page === 'reviews' && !nav().some(([key]) => key === page)) {
      reviewViews.reset();
      page = 'dashboard';
      history.replaceState(null, '', location.pathname + '#dashboard');
    }
    page = currentPage();
    prepareOfflineDeparture();
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
  try { localStorage.removeItem(signOutMarker); } catch { /* The new session replaces the previous cookie. */ }
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
  const wasOpen = dialog.open;
  const previous = wasOpen && dialog.contains(document.activeElement) ? document.activeElement.dataset.action : undefined;
  delete dialog.dataset.taskId;
  delete dialog.dataset.workQueue;
  dialog.innerHTML = `<div class="dialog-inner"><div class="panel-head">
    <div><h2 id="dialog-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
    <button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icon('x')}</button>
  </div>${body}</div>`;
  if (!wasOpen) dialog.showModal();
  else (previous && dialog.querySelector(`[data-action="${CSS.escape(previous)}"]`) || dialog.querySelector('[data-action="close"]')).focus();
}

dialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const items = [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter((item) => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length);
  const index = items.indexOf(document.activeElement);
  const target = event.shiftKey && index <= 0 ? items.at(-1) :
    !event.shiftKey && (index === -1 || index === items.length - 1) ? items[0] : null;
  if (target) {
    event.preventDefault();
    target.focus();
  }
});

function entryForm(kind, fields, label, cancel = true) {
  return `<form data-form="${kind}"><div class="form-grid">${fields}</div><p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions">${cancel ? '<button type="button" class="btn secondary" data-action="close">Cancel</button>' : ''}<button class="btn primary" type="submit">${label}</button></div>
  </form>`;
}

function profileForm({ note, version }) {
  openDialog('My profile', e(actor().email), `
    <div class="card-actions">${actionButton('Change password', 'change-password', 'key-round', 'secondary')}
    ${actionButton('Profile photos', 'profile-files', 'image', 'secondary', actorId)}</div>
    ${entryForm('profile/notes', `<input type="hidden" name="version" value="${version}">
      <label class="full">Private notepad<textarea name="note" rows="6" maxlength="6000">${e(note)}</textarea></label>`, 'Save notes')}
  `);
}

function taskDraftForm(task) {
  const draft = state.taskDrafts.find((item) => item.task_id === task.id);
  openDialog('Progress and completion draft', e(task.title), entryForm('task-draft', `
    <input type="hidden" name="taskId" value="${task.id}">
    <input type="hidden" name="taskVersion" value="${task.work_revision}">
    <input type="hidden" name="version" value="${draft?.version ?? 0}">
    <p class="full">Your progress and draft are private. Use Submit work for review to send the final report.</p>
    <label class="full">Progress update<textarea name="progress" rows="3" maxlength="2000">${e(draft?.progress)}</textarea></label>
    <label class="full">Completion draft<textarea name="completion" rows="4" maxlength="1500">${e(draft?.completion)}</textarea></label>
  `, 'Save progress and draft'));
}

function workQueueBanner() {
  const jobs = offlineStorage?.work.list() ?? [];
  if (!jobs.length) return '';
  const conflicts = jobs.filter((job) => job.blocked).length;
  return `<aside class="panel work-sync"><span role="status">${jobs.length} saved ${jobs.length === 1 ? 'update' : 'updates'} awaiting sync${conflicts ? ' · ' + conflicts + ' to review' : ''}</span>
    ${actionButton('View saved updates', 'work-sync', 'refresh-cw', 'secondary')}</aside>`;
}

function workQueueDialog() {
  const items = offlineStorage?.work.list() ?? [];
  openDialog('Saved updates', 'Only this account can synchronize or reopen these encrypted updates.', items.length ? `<ul class="sync-list">${items.map((job) =>
    `<li><strong>${e(studioDate.format(job.createdAt))} · ${e(time(job.createdAt))}</strong>
      <p>${job.blocked ? 'This update could not be applied. Open it to recover your text before discarding it.' : 'Waiting to sync.'}</p>
      <div class="card-actions">${job.blocked && navigator.onLine ? `<button type="button" class="btn secondary" data-action="recover-work"
        data-value="${e(job.id)}">Open saved update</button>` : ''}
        <button type="button" class="btn secondary" data-action="discard-work" data-value="${e(job.id)}">Discard update</button></div>
    </li>`).join('')}</ul>` : empty('All saved updates have synchronized.'));
  dialog.dataset.workQueue = 'true';
}

function recoveredText(path, data) {
  if (path === 'profile/notes') return data.note;
  if (path === 'task-draft') return [data.progress, data.completion].filter(Boolean).join('\n\n');
  if (path === 'operations/plan') return [data.date, ...data.entries.map((entry) =>
    entry.from + '–' + entry.to + ' · ' + entry.title + ' · ' + entry.category + ' · ' + entry.location), data.reason].filter(Boolean).join('\n');
  if (path === 'hr/work-logs') return [data.day, data.minutes + ' minutes', data.note].join('\n');
  return [data.from, data.to, data.clockIn, data.clockOut, data.leaveType, data.reason].filter(Boolean).join('\n');
}

async function sendWork(path, data) {
  const storage = offlineStorage?.work;
  const person = actorId;
  const activeSession = sessionVersion;
  if (!storage) {
    if (!navigator.onLine) throw new Error('Connect to the workspace to prepare encrypted offline saving for this device.');
    return request(path, data);
  }
  const job = await storage.seal(path, data, person);
  if (activeSession !== sessionVersion) throw new Error('Open your workspace again before saving.');
  let stored = false;
  try {
    storage.save(job);
    stored = true;
  } catch {
    if (!navigator.onLine) throw new Error('This device could not save the encrypted update. Keep this form open until you reconnect.');
  }
  if (navigator.onLine) {
    try {
      const response = await request('offline/synchronize', job.envelope);
      if (stored) storage.remove(job.id);
      return response;
    } catch (error) {
      if (!stored || (error.status >= 400 && error.status < 500 && ![401, 429].includes(error.status))) {
        if (stored) storage.remove(job.id);
        throw error;
      }
    }
  }
  return { queued: true };
}

async function syncSavedWork() {
  const storage = offlineStorage?.work;
  if (!storage || !actor() || !navigator.onLine || workSync || pending) return;
  const jobs = storage.list().filter((job) => !job.blocked);
  if (!jobs.length) return;
  const token = {};
  workSync = token;
  let changed = false;
  let applied = 0;
  try {
    for (const job of jobs) {
      if (workSync !== token || storage !== offlineStorage?.work || !navigator.onLine) break;
      try {
        await request('offline/synchronize', job.envelope);
        storage.remove(job.id);
        applied++;
      } catch (error) {
        if (!(error.status >= 400 && error.status < 500) || [401, 429].includes(error.status)) break;
        storage.save({ ...job, blocked: true });
      }
      changed = true;
    }
    if (changed && workSync === token) {
      if (applied) profileNote = undefined;
      if (dialog.open && dialog.dataset.workQueue) workQueueDialog();
      if (applied) await refreshAfterSave();
      else render();
      showToast(applied ? 'Saved updates synchronized.' : 'A saved update needs review.');
    }
  } catch {
    // The server deduplicates any update the device could not remove.
  } finally {
    if (workSync === token) workSync = undefined;
  }
}

async function fileRequest(path, method = 'GET', file) {
  const options = { method, signal: AbortSignal.timeout(30_000) };
  if (file) {
    options.headers = { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) };
    options.body = file;
  }
  const response = await fetch('/api/files' + path, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) clearWorkspace({ actor: null });
    throw new Error(result.error || 'The attachment request failed.');
  }
  return result;
}

async function uploadFormFile(form, taskId, file) {
  if (!file?.size) return undefined;
  const fileKey = [file.name, file.size, file.lastModified].join('|');
  if (form.dataset.uploadKey !== fileKey) {
    const result = await fileRequest(fileQuery('task', taskId), 'POST', file);
    form.dataset.uploadKey = fileKey;
    form.dataset.uploadId = result.id;
  }
  return form.dataset.uploadId;
}

function fileQuery(kind, record) {
  return '?' + new URLSearchParams({ kind, record });
}

const fileContextNames = { task: 'Task files', project: 'Project files', client: 'Client files', expense: 'Expense receipts', profile: 'Profile photos' };

async function filesDialog(kind, record) {
  const items = await fileRequest(fileQuery(kind, record));
  const task = kind === 'task' ? state.tasks.find((item) => item.id === record) : null;
  const canAdd = !task || (!task.completed_at && task.shoot_status === 'booked');
  const active = kind === 'profile' ? employee(record)?.active_photo_id : null;
  const label = kind === 'profile' ? 'PNG or JPEG, up to 3 MB' : 'PNG, JPEG or PDF, up to 10 MB';
  openDialog(fileContextNames[kind], label, `
    <div class="operation-stack">
      ${items.length ? items.map((item) => `<div class="notice-row">
        ${kind === 'profile' ? `<img class="profile-photo-preview" src="/api/files/${e(item.id)}?preview=1" alt="Uploaded profile photo" width="64" height="64">` : ''}
        <div><a class="text-link" href="/api/files/${e(item.id)}">${e(item.name)}</a>
        <p>${item.id === active ? 'Active photo · ' : ''}${Math.ceil(item.byte_length / 1024)} KB · ${shortDate.format(item.created_at)}</p></div>
        ${kind === 'profile' && item.id !== active ? `<button class="btn secondary" type="button" data-action="activate-photo"
          data-id="${record}" data-file-id="${e(item.id)}">Use photo</button>` : ''}
        ${item.id !== task?.completion_file_id && (kind !== 'task' || manager() || item.uploaded_by === actorId)
          ? `<button type="button" class="btn secondary" data-action="remove-file" data-kind="${kind}" data-id="${record}" data-file-id="${e(item.id)}">Remove file</button>` : ''}</div>`).join('')
      : empty('No files uploaded.')}
      ${canAdd ? entryForm('local-file', `
        <input type="hidden" name="kind" value="${kind}">
        <input type="hidden" name="record" value="${record}">
        <label class="full">Select a file<input name="attachment" type="file" required accept="${kind === 'profile' ? 'image/png,image/jpeg' : 'image/png,image/jpeg,application/pdf'}"></label>
      `, 'Upload file', false) : ''}
    </div>`);
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
    <label class="full">Address<input name="postalAddress" maxlength="350" value="${e(client?.postal_address)}"></label>
    <label class="full">Category<input name="category" maxlength="100" value="${e(client?.category)}"></label>
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

function additionalSiteControls(task, kind = 'shoot') {
  const saved = additionalShootLocations(task);
  const rows = saved.length ? saved : [{}];
  return `<label class="full shoot-multiple-toggle"><input name="multipleShootLocations" type="checkbox" aria-controls="additional-shoot-sites"
    ${saved.length ? 'checked' : ''}> Multiple ${kind} locations</label>
    <fieldset class="full additional-shoot-sites" id="additional-shoot-sites" ${saved.length ? '' : 'hidden disabled'}>
      <legend>Additional locations</legend>
      <p class="field-note">Enter a Maps link or coordinates for each stop. ${kind === 'office' ? 'Employees can check in at any saved office.' : 'Assigned crew can check in at any saved pin.'}</p>
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
    <label class="full">Address<input name="address" maxlength="350" value="${e(office?.address)}"></label>
    ${mapFields(office ?? {})}
    ${additionalSiteControls(office, 'office')}
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
      ${manager() && !parentShootId && (!task || task.is_unscheduled) ? `<label class="full check-row"><input type="checkbox" name="unscheduled"
        ${task?.is_unscheduled ? 'checked' : ''}> Assign without a scheduled start</label>` : ''}
      <fieldset class="full form-grid task-planned-time" ${task?.is_unscheduled ? 'hidden disabled' : ''}>
        <label>Scheduled date<input name="startDate" type="date" required value="${task && !task.is_unscheduled ? day(task.start_at) : today()}"></label>
        <label>Scheduled time (IST)<input name="startTime" type="time" required value="${task && !task.is_unscheduled ? studioTimeInput.format(task.start_at) : ''}"></label>
      </fieldset>
      <label>Duration in minutes<input name="estimate" type="number" required min="1" max="1440" value="${task?.estimate ?? 60}"></label>
    </fieldset>
    ${parentShootId ? `<label>Delivery deadline (IST)<input name="deliveryDue" type="datetime-local" required value="${task?.delivery_due_at ? studioDateTimeInput(task.delivery_due_at) : ''}"></label>` : ''}
    <label>Location name<input name="location" required maxlength="100" value="${e(task?.location ?? (sourceShoot ? state.office?.name : ''))}"></label>
    <fieldset class="full shoot-fields" ${isShoot ? '' : 'hidden disabled'}><legend>Shoot and client details</legend>
      <div class="form-grid">
        ${!self && !task ? `<label class="full emergency-option" ${isOpen ? 'hidden' : ''}>
          <span><input name="emergency" type="checkbox" ${isOpen ? 'disabled' : ''}> Emergency shoot</span>
          <small>Conflicting non-shoot tasks will be paused and queued for rescheduling.</small>
        </label>` : ''}
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
        <label class="full project-picker" ${clientId ? '' : 'hidden'}>Project (optional)<select name="projectId" ${clientId ? '' : 'disabled'}>
          <option value="">No project</option>${state.projects.filter((item) => item.client_id === clientId).map((item) =>
            `<option value="${item.id}"${item.id === task?.project_id ? ' selected' : ''}>${e(item.name)}</option>`).join('')}
        </select></label>
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
    <label class="full">Payment category<input name="category" maxlength="100" value="${e(payment?.category || 'Shoot payment')}"></label>
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
  if (offlineDeparture || offlineKeyCheck?.restoring) return null;
  const latest = latestShift();
  const current = latest?.clock_out === null;
  const site = current
    ? (latest.site ? JSON.parse(latest.site) : null)
    : returnSite(latest, state.office, state.tasks.filter((task) => !task.is_open), actorId, Date.now(), state.hrSettings);
  return site ? { site, current, shiftId: latest.id, verifiedAt: latest.last_verified_at ?? latest.clock_in } : null;
}

function setWatchStatus(message) {
  document.querySelectorAll('[data-location-watch]').forEach((element) => {
    if (element.textContent !== message) element.textContent = message;
  });
}

function stopTracking() {
  if (watcher) {
    navigator.geolocation.clearWatch(watcher.id);
    clearTimeout(watcher.boundaryTimer);
  }
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
  else if (watcher.boundaryTimer) setWatchStatus('Confirming the geofence change with a second GPS reading.');
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
  sampleWatcher(watch);
}

function sampleWatcher(watch) {
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
        inside: `Within ${site.radius ?? fenceRadius} m of ${site.name}.`,
        outside: `Outside the ${site.radius ?? fenceRadius} m boundary for ${site.name}.`,
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
  if (!verify && !watch.boundaryTimer && presence !== (target.current ? 'outside' : 'inside')) return;
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
    if (actorId !== employeeId || watcher !== watch) return;
    clearTimeout(watch.boundaryTimer);
    if (shift?.boundaryPending) {
      watch.boundaryTimer = setTimeout(() => {
        if (watcher === watch && document.visibilityState === 'visible') sampleWatcher(watch);
      }, (state.hrSettings.boundary_delay_ms ?? boundarySampleDelay) + 150);
      updateTracking();
      return;
    }
    watch.boundaryTimer = undefined;
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
  projects: 'Project saved.', 'projects/resource': 'Project resource saved.',
  'revenue/save': 'Allocations saved.',
  scopes: 'Access saved.', roles: 'Role permissions saved.', 'roles/assign': 'Access role saved.', 'hr/review': 'Request reviewed.',
  'footage/historical': 'Storage verifications saved.', 'footage/manager': 'Storage manager updated.', 'footage/submit': 'Verification submitted.', 'footage/review': 'Verification reviewed.',
  attendance: 'Shift ended.', 'attendance/period': 'Timer started.',
  'attendance/review-shift': 'Shift review saved.', 'worksheet/remark': 'Remark saved.',
  'operations/plan': 'Draft saved.', 'operations/review-plan': 'Plan reviewed.',
  'operations/task-change': 'Task change submitted.', 'operations/review-change': 'Task change reviewed.',
  'operations/completion': 'Completion review saved.',
  employees: 'Employee saved.', clients: 'Client saved.', tasks: 'Schedule saved.', office: 'Company location saved.',
  'work-requests': 'Request sent.', 'hr/requests': 'Request sent.', 'hr/settings': 'Settings saved.',
  'hr/holidays': 'Holiday saved.', 'hr/payslips': 'Payslip saved.', 'hr/announcements': 'Announcement saved.',
  'hr/work-logs': 'Work logged.', 'task-action': 'Task blocked.', payments: 'Payment recorded.', expenses: 'Expense saved.',
  'payment-due': 'Payment due date saved.', 'request-decisions': 'Request approved.',
  'profile/notes': 'Notes saved.', 'employees/access': 'Account access updated.',
  'task-draft': 'Progress and draft saved.',
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

async function persistDeparture(job) {
  const storage = offlineStorage;
  if (!storage || !job.command || job.saving) return;
  job.saving = true;
  try {
    const encrypted = await storage.save(job.command);
    if (offlineDeparture === job && encrypted) job.encrypted = encrypted;
  } catch {
    // A loaded tab can still submit the report if persistent browser storage is unavailable.
  } finally {
    job.saving = false;
    if (offlineDeparture === job) {
      render();
      syncOfflineDeparture();
    }
  }
}

async function prepareOfflineDeparture() {
  if (offlineStorage || offlineKeyCheck || !actor() || !navigator.onLine || !globalThis.crypto?.subtle) return;
  const check = { restoring: hasSavedDeparture() };
  offlineKeyCheck = check;
  try {
    const [storage, note] = await Promise.all([
      request('attendance/offline-key').then(prepareDepartureStorage),
      request('profile').catch(() => undefined),
    ]);
    if (offlineKeyCheck !== check) return;
    offlineStorage = storage;
    profileNote = note;
    if (storage.work.list().length) {
      render();
      syncSavedWork();
    }
    const encrypted = storage.load();
    if (encrypted && !offlineDeparture) {
      offlineDeparture = { encrypted };
      render();
      await syncOfflineDeparture();
    } else if (offlineDeparture) {
      await persistDeparture(offlineDeparture);
    }
  } catch {
    // Live attendance and in-memory departure reports remain available.
  } finally {
    if (offlineKeyCheck === check) {
      offlineKeyCheck = undefined;
      updateTracking();
    }
  }
}

async function syncOfflineDeparture() {
  if (!offlineDeparture || offlineDeparture.error || offlineDeparture.saving || syncingDeparture || pending || !actor() || !navigator.onLine) return;
  const job = offlineDeparture;
  syncingDeparture = true;
  try {
    const result = await request('attendance/offline-departure', job.encrypted ? { encrypted: job.encrypted } : job.command);
    if (offlineDeparture !== job) return;
    if (job.encrypted) offlineStorage?.remove(job.encrypted);
    offlineDeparture = undefined;
    showToast(result.status === 'conflict' ? 'Departure sent for review. The attendance record had already changed.' :
      'Departure sent for review with GPS unverified.');
    await refreshAfterSave();
  } catch (error) {
    if (offlineDeparture === job && error.status >= 400 && error.status < 500 && error.status !== 429) {
      job.error = error.message;
      render();
    }
  } finally {
    syncingDeparture = false;
  }
}

function connectivityChanged() {
  const label = document.querySelector('.connection-status');
  if (label) label.hidden = navigator.onLine;
  if (navigator.onLine) {
    if (!actor()) finishDeferredSignOut();
    prepareOfflineDeparture();
    syncSavedWork();
    if (offlineDeparture) syncOfflineDeparture();
    else restartLocationTracking();
  } else updateTracking();
}

function deferredSignOut() {
  try { return localStorage.getItem(signOutMarker) === '1'; } catch { return false; }
}

async function finishDeferredSignOut() {
  if (!deferredSignOut() || !navigator.onLine) return;
  try {
    const subscription = webPushEnabled ? await currentPushSubscription() : null;
    await workspaceRequest('logout', { pushEndpoint: subscription?.endpoint });
    if (subscription) await subscription.unsubscribe().catch(() => {});
    localStorage.removeItem(signOutMarker);
  } catch {
    // Keep the workspace locked until the browser can revoke the old session.
  }
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
  if (Object.hasOwn(reviewViews.actions, action)) {
    reviewViews.actions[action](button, value, id);
    return;
  }
  if (Object.hasOwn(auditViews.actions, action)) {
    auditViews.actions[action](button, value, id);
    return;
  }
  if (Object.hasOwn(scopedViews.actions, action)) {
    scopedViews.actions[action](button, value, id);
    return;
  }
  if (Object.hasOwn(projectViews.actions, action)) {
    projectViews.actions[action](button, value, id);
    return;
  }
  if (Object.hasOwn(footageViews.actions, action)) {
    footageViews.actions[action](button, value, id);
    return;
  }
  if (Object.hasOwn(worksheetViews.actions, action)) {
    worksheetViews.actions[action](button, value, id);
    return;
  }
  if (Object.hasOwn(operationsViews.actions, action)) {
    operationsViews.actions[action](button, value, id);
    return;
  }
  if (hrViews && Object.hasOwn(hrViews.actions, action)) {
    hrViews.actions[action](button, value, id);
    return;
  }
  switch (action) {
    case 'task-files': case 'project-files': case 'client-files': case 'expense-files': case 'profile-files':
      mutate(button, () => filesDialog(action.slice(0, -6), id));
      break;
    case 'activate-photo':
      mutate(button, async () => {
        await request('profile/photo', { employeeId: id, fileId: button.dataset.fileId });
        await refreshAfterSave();
        await filesDialog('profile', id);
      });
      break;
    case 'remove-file':
      mutate(button, async () => {
        await fileRequest('/' + encodeURIComponent(button.dataset.fileId), 'DELETE');
        showToast('File removed.');
        if (button.dataset.kind === 'profile') await refreshAfterSave();
        await filesDialog(button.dataset.kind, id);
      });
      break;
    case 'allocate-revenue':
      mutate(button, async () => revenueViews.allocationForm(await request('revenue/allocations', { shootId: id })));
      break;
    case 'discard-offline-departure':
      if (offlineDeparture?.encrypted) offlineStorage?.remove(offlineDeparture.encrypted);
      offlineDeparture = undefined;
      render();
      break;
    case 'policy-history':
      mutate(button, async () => {
        const { history } = await request('settings/history');
        openDialog('Work policy history', 'Worksheets use the policy effective on the day worked.', table('Policy history',
          ['Effective date (IST)', 'Daily target', 'Plan deadline', 'Task reminder'], history.map((row) => {
            const settings = JSON.parse(row.settings);
            return [row.changed_at ? e(row.effective_from) : 'Baseline', settings.required_minutes + ' min', e(settings.plan_deadline),
              settings.task_reminder_minutes ? settings.task_reminder_minutes + ' min' : 'Off'];
          })));
      });
      break;
    case 'operations-audit':
      mutate(button, async () => {
        const rows = await request('operations/audit');
        openDialog('Business audit', 'Most recent workflow changes.', rows.length ?
          table('Business audit', ['Date (IST)', 'Actor', 'Record', 'Action', 'Details'], rows.map((row) => [
            e(studioDateTimeInput(row.occurred_at).replace('T', ' ')), e(row.actor || 'System'),
            e(row.subject + ' #' + row.record_id), e(row.action), e(row.details || '—'),
          ])) : empty('No audit events yet.'));
      });
      break;
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
        try {
          if (!navigator.onLine) throw new Error('Reconnect to sign out of the server.');
          const subscription = webPushEnabled ? await currentPushSubscription() : null;
          await request('logout', { pushEndpoint: subscription?.endpoint });
          if (subscription) await subscription.unsubscribe().catch(() => {});
        } catch (error) {
          try { localStorage.setItem(signOutMarker, '1'); } catch { throw error; }
        }
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
      mutate(button, async () => {
        if (navigator.onLine) profileNote = await request('profile');
        if (!profileNote) throw new Error('Open the notepad while connected to load your latest notes.');
        profileForm(profileNote);
      });
      break;
    case 'task-draft':
      if (task()) taskDraftForm(task());
      break;
    case 'work-sync':
      workQueueDialog();
      break;
    case 'discard-work':
      if (confirm('Discard this saved update from the device?')) {
        offlineStorage?.work.remove(value);
        render();
        workQueueDialog();
      }
      break;
    case 'recover-work':
      mutate(button, async () => {
        const job = offlineStorage?.work.list().find((item) => item.id === value);
        if (!job) return;
        const { path, data } = await request('offline/recover', job.envelope);
        openDialog('Recover saved update', 'Copy the text you need and reopen the latest record before applying your changes.',
          `<label class="full">Saved text<textarea readonly rows="8">${e(recoveredText(path, data))}</textarea></label>`);
      });
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
    case 'previous-clients': case 'next-clients':
      clientPage += action === 'next-clients' ? 1 : -1;
      render();
      document.querySelector('#client-search')?.focus();
      break;
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
    case 'print-finance': window.print(); break;
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
        { start: 'Timer started.', pause: 'Timer paused.', complete: 'Work marked complete.', acknowledge: 'Task acknowledged.', unblock: 'Task unblocked.' }[value]);
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
    case 'toggle-work-updates':
      mutate(button, async () => {
        const device = mobileDevice;
        const subscription = await currentPushSubscription();
        if (!subscription) throw new Error('Enable mobile alerts on this device first.');
        const result = await request('push/updates', { endpoint: subscription.endpoint, enabled: !device.updatesEnabled });
        if (mobileDevice === device) {
          device.updatesEnabled = result.updatesEnabled;
          render();
        }
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
        mobileDevice.updatesEnabled = false;
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
  if (input.id === 'finance-year') {
    if (input.value && !/^(19|[2-9]\d)\d{2}$/.test(input.value)) {
      showToast('Enter a four-digit year.');
      return;
    }
    financeMonth = input.value;
    render();
    document.querySelector('#finance-year')?.focus();
    return;
  }
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
  if (input.id === 'client-search') {
    clientSearch = input.value.trim();
    clientPage = 0;
    render();
    document.getElementById(input.id)?.focus();
    return;
  }
  if (Object.hasOwn(projectViews.filters, input.id)) {
    projectViews.filters[input.id](input.value);
    render();
    document.getElementById(input.id)?.focus();
    return;
  }
  const filters = Object.hasOwn(operationsViews.filters, input.id) ? operationsViews.filters : hrViews?.filters;
  if (filters && Object.hasOwn(filters, input.id)) {
    filters[input.id](input.value);
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
  if (input.id === 'permission-role') {
    const role = input.value;
    mutate(input, async () => reviewViews.roleSettings(await request('roles'), role));
    return;
  }
  if (input.matches('[data-task-change-kind]')) {
    form.querySelectorAll('[data-change-field]').forEach((field) => {
      field.hidden = field.dataset.changeField !== input.value;
      field.querySelector('input, select').disabled = field.hidden;
    });
  }
  if (input.name === 'multipleShootLocations' && form) {
    toggleFields(form.querySelector('.additional-shoot-sites'), input.checked);
  }
  if (form?.dataset.form !== 'tasks') return;
  if (['category', 'shootFrom', 'shootTo', 'employeeId', 'crew', 'assignment', 'shootStatus'].includes(input.name)) {
    const notice = form.querySelector('[data-conflicts]');
    if (notice) {
      notice.hidden = true;
      notice.replaceChildren();
    }
  }
  if (input.name === 'unscheduled') toggleFields(form.querySelector('.task-planned-time'), !input.checked);
  if (input.name === 'category' && form.querySelector('.shoot-fields')) {
    const shoot = input.value === 'Photo shoot';
    toggleFields(form.querySelector('.shoot-fields'), shoot);
    toggleFields(form.querySelector('.shoot-time-fields'), shoot);
    toggleFields(form.querySelector('.task-time-fields'), !shoot);
  }
  if (input.name === 'shootFrom' && input.value && !form.elements.shootTo.value) {
    form.elements.shootTo.value = studioDateTimeInput(Date.parse(`${input.value}:00+05:30`) + 60 * 60_000);
  }
  if (input.name === 'clientId') {
    toggleFields(form.querySelector('.owner-fields'), !input.value);
    const select = form.elements.projectId;
    select.closest('label').hidden = !input.value;
    select.disabled = !input.value;
    select.replaceChildren(new Option('No project', ''), ...state.projects.filter((item) => item.client_id === Number(input.value))
      .map((item) => new Option(item.name, String(item.id))));
    if (!input.value && form.elements.id?.value) select.disabled = false;
  }
  if (input.name === 'assignment') {
    const direct = input.value !== 'open';
    form.querySelector('.assignee').hidden = !direct;
    form.elements.employeeId.disabled = !direct;
    if (form.elements.unscheduled) {
      if (!direct && form.elements.unscheduled.checked) {
        form.elements.unscheduled.checked = false;
        toggleFields(form.querySelector('.task-planned-time'), true);
      }
      form.elements.unscheduled.disabled = !direct;
    }
    const emergency = form.querySelector('.emergency-option');
    if (emergency) {
      emergency.hidden = !direct;
      form.elements.emergency.disabled = !direct;
    }
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
  if (kind === 'attendance' && data.action === 'end-shift' && !navigator.onLine) {
    offlineDeparture = { command: {
      requestId: crypto.randomUUID(), shiftId: Number(data.shiftId), reportedAt: Date.now(), employeeId: actorId,
    } };
    if (dialog.open) dialog.close();
    stopTracking();
    render();
    persistDeparture(offlineDeparture);
    return;
  }
  if (kind === 'attendance' && data.action === 'end-shift' && watcher?.employeeId === actorId &&
      watcher.fix?.capturedAt >= Date.now() - maxFixAge) data.location = watcher.fix;
  if (kind === 'roles') data.permissions = fields.getAll('permission');
  if (kind === 'scopes') data.enabled = data.enabled === 'true';
  if (data.delegated === 'true') data.delegated = true;
  if (kind === 'revenue/save') {
    const staff = fields.getAll('allocationEmployee');
    const types = fields.getAll('allocationType');
    data.allocations = fields.getAll('allocationValue').flatMap((value, index) =>
      value ? [{ employeeId: staff[index], type: types[index], value }] : []);
  }
  if (kind === 'footage/historical') data.ids = fields.getAll('shoot');
  if (kind === 'footage/submit') {
    data.transferred = fields.has('transferred');
    data.stored = fields.has('stored');
  }
  if (kind === 'employees/access') data.active = data.active === 'true';
  if (kind === 'hr/settings') {
    for (const key of ['personalBreakPaid','travelPaid','attachmentRequired']) {
      if (Object.hasOwn(data, key)) data[key] = data[key] === 'true';
    }
  }
  if (kind === 'operations/plan') {
    const columns = ['entryTitle', 'entryFrom', 'entryTo', 'entryCategory', 'entryLocation'].map((key) => {
      delete data[key];
      return fields.getAll(key);
    });
    data.entries = columns[0].map((title, index) => ({
      title, from: columns[1][index], to: columns[2][index], category: columns[3][index], location: columns[4][index],
    }));
  }
  if (kind === 'operations/task-change' && data.kind === 'reschedule') data.start = `${data.proposedDateTime}:00+05:30`;
  if (kind === 'tasks') {
    data.emergency = fields.has('emergency');
    data.unscheduled = data.category !== 'Photo shoot' && fields.has('unscheduled');
    if (data.category === 'Photo shoot' || data.parentShootId) {
      data.startAt = `${data.shootFrom}:00+05:30`;
      data.endAt = `${data.shootTo}:00+05:30`;
      if (form.querySelector('.crew-fields')) data.crew = fields.getAll('crew');
    } else if (!data.unscheduled) {
      data.startAt = `${data.startDate}T${data.startTime}:00+05:30`;
    }
    if (data.parentShootId) data.deliveryDueAt = `${data.deliveryDue}:00+05:30`;
  }
  if (kind === 'office' || (kind === 'tasks' && !data.delegated && data.category === 'Photo shoot')) {
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
      if (kind === 'local-file') {
        await fileRequest(fileQuery(data.kind, data.record), 'POST', data.attachment);
        await filesDialog(data.kind, Number(data.record));
        showToast('File uploaded.');
        return;
      }
      if (kind === 'footage/submit') {
        data.screenshotId = await uploadFormFile(form, data.taskId, data.screenshot) || data.existingScreenshot || undefined;
        delete data.screenshot;
      }
      if (kind === 'task-action' && data.action === 'submit-completion') {
        data.fileId = await uploadFormFile(form, data.taskId, data.evidence);
        delete data.evidence;
      }
      if (kind === 'revenue/report') {
        await revenueViews.load(data, request);
        return;
      }
      if (kind === 'audit/search') {
        await auditViews.load(data);
        return;
      }
      if (kind === 'worksheet') {
        await worksheetViews.load(data, request);
        return;
      }
      const result = offlineWorkForms.has(kind) ? await sendWork(kind, data) : await request(kind, data);
      if (kind === 'profile/notes') profileNote = { note: data.note, version: result.queued ? Number(data.version) + 1 : result.version };
      if (result?.queued) {
        if (dialog.open && dialog.contains(form)) dialog.close();
        render();
        showToast('Saved to this device. Your update will sync after reconnecting.');
        return;
      }
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
      if (ownsDialog && kind === 'tasks' && !data.delegated && !data.parentShootId && !['schedule', 'shoot-calendar', 'task-board'].includes(page)) {
        location.hash = data.category === 'Photo shoot' ? '#shoot-calendar' : '#task-board';
      }
      showToast(data.action === 'submit-completion' ? 'Work submitted for review.' : savedMessages[kind]);
      await refreshAfterSave();
      if (page === 'reviews') await reviewViews.load();
      if (page === 'scoped-work') await scopedViews.load();
      if (page === 'worksheet' && (kind === 'worksheet/remark' || kind === 'attendance/review-shift')) {
        await worksheetViews.load(worksheetViews.scope(), request);
      }
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
  const pageTitle = main.querySelector('h1');
  if (pageTitle) {
    pageTitle.tabIndex = -1;
    pageTitle.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
});

export function startWorkspace({ restore } = {}) {
  if (restore && deferredSignOut()) {
    loginPage();
    finishDeferredSignOut();
  } else if (restore) loadSession();
  navigator.serviceWorker?.register('/push-worker.js').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      restartLocationTracking();
      if (session?.actor && navigator.onLine) refresh().catch(() => {});
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) restartLocationTracking();
  });
  window.addEventListener('online', connectivityChanged);
  window.addEventListener('offline', connectivityChanged);
  window.addEventListener('storage', (event) => {
    if (event.key === signOutMarker && event.newValue === '1' && actor()) clearWorkspace({ actor: null });
  });
  setInterval(tick, 1000);
  setInterval(() => {
    if (offlineDeparture) syncOfflineDeparture();
    syncSavedWork();
    prepareOfflineDeparture();
    if (!pending && !observing && session?.actor && navigator.onLine && document.visibilityState === 'visible') refresh().catch(() => {});
  }, 15000);
}
