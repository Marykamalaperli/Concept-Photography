import { businessLabels } from './scoped-views.js';
const roles = ['Photographer', 'Videographer', 'Video Editor', 'Photo Editor', 'Data Storage Manager', 'Studio Assistant', 'General Employee'];
const capabilities = {
  'review-plans': 'Review daily plans',
  'review-tasks': 'Review task changes and completions',
  'review-attendance': 'Review shifts, leave and attendance corrections',
  'review-footage': 'Review footage storage',
  ...businessLabels,
};
const decisions = {
  plan: ['operations/review-plan', 'decision', ['approved','rejected'], 'id'],
  change: ['operations/review-change', 'decision', ['approved','rejected'], 'id'],
  completion: ['operations/completion', 'decision', ['approve','return'], 'taskId'],
  shift: ['attendance/review-shift', 'status', ['accepted','follow-up'], 'id'],
  request: ['hr/review', 'status', ['approved','declined'], 'id'],
  footage: ['footage/review', 'status', ['approved','returned'], 'id'],
};
const labels = {
  approved: 'Approve', rejected: 'Reject', approve: 'Approve', return: 'Return', accepted: 'Accept', 'follow-up': 'Follow up',
  declined: 'Decline', returned: 'Return',
};

export function createReviewViews(ui) {
  const { actor, e, employee, heading, actionButton, openDialog, entryForm, empty, day, time, duration, request, mutate } = ui;
  let queue;
  let generation = 0;

  function roleSettings(matrix, selected = roles[0]) {
    const relevant = new Set(matrix.filter((r) => r.role === selected).map((r) => r.permission));
    openDialog('Role permissions', 'Changes apply to every employee with this access role.', entryForm('roles', `
      <label class="full">Access role<select id="permission-role" name="role">
        ${roles.map((role) => `<option${role === selected ? ' selected' : ''}>${role}</option>`).join('')}
      </select></label>
      ${Object.entries(capabilities).map(([key,label]) => `<label class="check-row full">
        <input type="checkbox" name="permission" value="${key}"${relevant.has(key) ? ' checked' : ''}> ${label}</label>`).join('')}`,
    'Save permissions'));
  }

  function assignment(person) {
    openDialog('Employee access role', e(person.name), entryForm('roles/assign', `
      <input type="hidden" name="employeeId" value="${person.id}">
      <label class="full">Access role<select name="role">
        ${roles.map((role) => `<option${role === person.permission_role ? ' selected' : ''}>${role}</option>`).join('')}
      </select></label>`, 'Save access role'));
  }

  function decision(kind, id, state) {
    const [path, actionField, _states, idField] = decisions[kind];
    const required = state === 'rejected' || state === 'return' || state === 'returned' || kind === 'shift';
    openDialog(labels[state] + ' request', '', entryForm(path, `
      <input type="hidden" name="${idField}" value="${id}"><input type="hidden" name="${actionField}" value="${state}">
      ${kind === 'request' ? '' : `<label class="full">Review note<textarea name="note" rows="3" maxlength="600"${required ? ' required' : ''}></textarea></label>`}`,
    labels[state]));
  }

  function reviewRecord(kind, row, title, details) {
    const supported = kind === 'footage' && row.status === 'incident' ? ['returned'] : decisions[kind][2];
    return `<article class="operation-record"><h3>${e(title)} · ${e(row.name)}</h3>${details}
      <div class="card-actions">${supported.map((result) => `<button type="button" class="btn secondary" data-action="queued-review"
        data-value="${kind}:${result}" data-id="${row.id}">${labels[result]}</button>`).join('')}</div></article>`;
  }

  function section(title, items) {
    return `<section class="panel"><div class="panel-head"><h2>${title}</h2></div>${items.length ? items.join('') : empty('Nothing to review.')}</section>`;
  }

  const evidence = (id) => id ? `<p><a class="text-link" href="/api/files/${e(id)}">Download evidence</a></p>` : '';

  function page() {
    const person = actor();
    const allowed = (key) => person.is_admin || person.permissions?.includes(key);
    return `${heading('Review queue', 'Review pending requests within your access role.', actionButton(queue ? 'Refresh queue' : 'Load queue', 'refresh-reviews', 'refresh-cw', 'secondary'))}
      ${queue ? `<div class="operation-stack">
        ${allowed('review-plans') ? section('Daily plans', queue.plans.map((row) => reviewRecord('plan', row, row.work_day,
          `<ol class="plan-entries-list">${JSON.parse(row.entries).map((entry) => `<li><time>${e(entry.from)}–${e(entry.to)}</time><span>${e(entry.title)} · ${e(entry.location)}</span></li>`).join('')}</ol>
          ${row.reason ? `<p>${e(row.reason)}</p>` : ''}`))) : ''}
        ${allowed('review-tasks') ? section('Task changes', queue.changes.map((row) => reviewRecord('change', row, row.title,
          `<p>${e(row.kind)} · ${e(row.reason)}</p>${row.minutes ? `<p>Additional minutes · ${row.minutes}</p>` : ''}
          ${row.proposed_start ? `<p>Proposed start · ${day(row.proposed_start)} ${time(row.proposed_start)} IST</p>` : ''}
          ${row.proposed_name ? `<p>Proposed assignee · ${e(row.proposed_name)}</p>` : ''}`))) : ''}
        ${allowed('review-tasks') ? section('Task completions', queue.completions.map((row) => reviewRecord('completion', row, row.title,
          `<p>${e(row.completion_report)}</p>${evidence(row.completion_file_id)}`))) : ''}
        ${allowed('review-attendance') ? section('Attendance and leave', queue.requests.map((row) => reviewRecord('request', row,
          row.kind === 'time' ? 'Time correction' : 'Leave', `<p>${e(row.day_from)}${row.day_to !== row.day_from ? ' to ' + e(row.day_to) : ''}
          ${row.leave_type ? ' · ' + e(row.leave_type) : ''}</p><p>${e(row.reason)}</p>${row.kind === 'time' ?
            `<p>In ${row.clock_in ? time(row.clock_in) : '—'} · Out ${row.clock_out ? time(row.clock_out) : '—'} IST</p>` : ''}`))) : ''}
        ${allowed('review-attendance') ? section('Shift exceptions', queue.shifts.map((row) => reviewRecord('shift', row, row.work_day,
          `<p>${duration(row.recorded_ms)} of ${duration(row.required_ms)} recorded</p>
          ${row.location_unverified ? '<p>Departure location unverified.</p>' : ''}
          ${row.next_plan_day ? `<p>Plan for ${e(row.next_plan_day)} missing.</p>` : ''}`))) : ''}
        ${allowed('review-footage') ? section('Footage storage', queue.storage.map((row) => reviewRecord('footage', row, row.title,
          `<p>${e([row.drive,row.folder,row.backup,row.note].filter(Boolean).join(' · '))}</p>${evidence(row.screenshot_id)}`))) : ''}
      </div>` : `<section class="panel">${empty('Load pending requests to begin reviewing.')}</section>`}`;
  }

  async function load() {
    const version = ++generation;
    const results = await request('reviews');
    if (version !== generation) return;
    queue = results;
    ui.render();
  }

  return {
    page, load, roleSettings,
    reset() { queue = undefined; generation++; },
    actions: {
      'refresh-reviews': (button) => mutate(button, load),
      'role-permissions': (button) => mutate(button, async () => roleSettings(await request('roles'))),
      'assign-access-role': (_button, _value, id) => assignment(employee(id)),
      'queued-review': (_button, value, id) => {
        const [kind, result] = value.split(':');
        decision(kind, id, result);
      },
    },
  };
}
