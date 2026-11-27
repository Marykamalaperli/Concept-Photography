import { dayLength, dayStart, studioDay, validDay } from './hr-policy.js';

export function createOperationsViews(ui) {
  const { state, actor, manager, e, actionButton, heading, openDialog, entryForm, empty, applyAction, time } = ui;
  let selectedDate = '';
  let interval = 'day';
  const taskById = (id) => state().tasks.find((item) => item.id === id);
  const status = (value) => value.replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
  const selected = () => selectedDate || ui.today();
  const taskButton = (task) => actionButton(e(task.title), 'details', 'arrow-right', 'secondary', task.id);
  const categories = ['Planning', 'Editing', 'Studio', 'Other'];

  function planEntry(entry = {}) {
    return `<fieldset class="full plan-entry form-grid" data-plan-entry>
      <legend>Planned task</legend>
      <label class="full">Task title<input name="entryTitle" required maxlength="100" value="${e(entry.title)}"></label>
      <label>Starts (IST)<input type="time" name="entryFrom" required value="${e(entry.from)}"></label>
      <label>Ends (IST)<input type="time" name="entryTo" required value="${e(entry.to)}"></label>
      <label>Work category<select name="entryCategory">${categories.map((category) => `<option${category === entry.category ? ' selected' : ''}>${category}</option>`).join('')}</select></label>
      <label>Location<input name="entryLocation" required maxlength="100" value="${e(entry.location)}"></label>
      ${actionButton('Remove task', 'remove-plan-entry', 'trash-2', 'secondary')}
    </fieldset>`;
  }

  function planForm(button, _value, id) {
    const date = button.dataset.date || selected();
    const existing = state().plans.find((plan) => plan.id === id);
    const editing = existing?.status === 'draft';
    openDialog(editing ? 'Edit daily draft' : existing ? 'Request plan revision' : 'New daily plan', date,
      entryForm('operations/plan', `
        <input type="hidden" name="date" value="${e(date)}">
        <input type="hidden" name="version" value="${editing ? existing.draft_version : 0}">
        ${editing ? `<input type="hidden" name="id" value="${existing.id}">` : ''}
        <div class="full plan-entries">${(existing ? JSON.parse(existing.entries) : [{}]).map(planEntry).join('')}</div>
        ${actionButton('Add planned task', 'add-plan-entry', 'plus', 'secondary')}
        <label class="full">Reason for revising an approved plan<textarea name="reason" maxlength="600" rows="2">${e(existing?.reason)}</textarea></label>
      `, 'Save draft'));
  }

  function reviewForm(path, field, id, title, value, required = false) {
    openDialog(title, '', entryForm(path, `
      <input type="hidden" name="${field}" value="${id}">
      <input type="hidden" name="decision" value="${e(value)}">
      <label class="full">Review note<textarea name="note" rows="3" maxlength="600" ${required ? 'required' : ''}></textarea></label>
    `, title));
  }

  function planRow(plan) {
    const entries = JSON.parse(plan.entries);
    const currentEmployee = plan.employee_id === actor().id;
    const open = state().plans.some((item) => item.employee_id === plan.employee_id && item.work_day === plan.work_day &&
      ['draft', 'submitted'].includes(item.status));
    const future = plan.work_day >= ui.today();
    return `<article class="panel operation-row">
      <header class="panel-head"><div><h2>${e(plan.work_day)}${manager() ? ' · ' + e(plan.employee_name) : ''}</h2><p>Revision ${plan.revision} · ${status(plan.status)}</p></div></header>
      <ol class="plan-entries-list">${entries.map((entry) => `<li><time>${e(entry.from)}–${e(entry.to)}</time><span><strong>${e(entry.title)}</strong> · ${e(entry.location)}</span></li>`).join('')}</ol>
      ${plan.reason ? `<p>${e(plan.reason)}</p>` : ''}
      ${plan.review_note ? `<p>${e(plan.review_note)}</p>` : ''}
      <div class="card-actions">
        ${currentEmployee && plan.status === 'draft' && future ? actionButton('Edit draft', 'daily-plan-edit', 'pencil', 'secondary', plan.id) +
          actionButton('Submit draft', 'daily-plan-submit', 'send', 'primary', plan.id) : ''}
        ${currentEmployee && plan.status === 'approved' && future && !open ? actionButton('Request revision', 'daily-plan-edit', 'pencil', 'secondary', plan.id) : ''}
        ${manager() && plan.status === 'submitted' ? actionButton('Approve plan', 'daily-plan-approve', 'check', 'primary', plan.id) +
          actionButton('Reject plan', 'daily-plan-reject', 'x', 'secondary', plan.id) : ''}
      </div>
    </article>`;
  }

  function planCalendar(date) {
    const anchor = dayStart(date);
    const start = interval === 'month' ? dayStart(date.slice(0, 7) + '-01') : anchor;
    const end = interval === 'month' ? dayStart(studioDay(start + dayLength * 32).slice(0, 7) + '-01') :
      anchor + dayLength * (interval === 'week' ? 7 : 1);
    const tasks = state().tasks.filter((task) => task.start_at < end && task.start_at + 60_000 * task.estimate > start &&
      !task.is_unscheduled && task.shoot_status === 'booked' && task.work_state !== 'reschedule' && !task.is_open).sort((a, b) => a.start_at - b.start_at);
    const days = new Map();
    for (const task of tasks) {
      const day = studioDay(Math.max(start, task.start_at));
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(task);
    }
    return `<section class="panel">
      <div class="operation-toolbar">
        <label>Calendar starts on<input type="date" id="plan-calendar-date" value="${e(date)}"></label>
        <label>Calendar view<select id="plan-calendar-interval">${['day', 'week', 'month'].map((option) =>
          `<option value="${option}"${option === interval ? ' selected' : ''}>${status(option)}</option>`).join('')}</select></label>
      </div>
      ${tasks.length ? [...days].map(([day, rows]) => `<div class="plan-calendar-day"><h2>${e(day)}</h2><ul class="plan-entries-list">${rows.map((task) =>
        `<li><time>${time(task.start_at)}</time>${taskButton(task)}</li>`).join('')}</ul></div>`).join('') : empty('No assignments in this period.')}
    </section>`;
  }

  function taskChanges() {
    const rows = state().taskChanges;
    const labels = { extension: 'Time extension', reschedule: 'Reschedule', reassign: 'Reassign' };
    return `<section class="panel">
      <div class="panel-head"><h2>Task changes</h2></div>
      ${rows.length ? rows.map((row) => `<article class="operation-record"><strong>${e(row.title)}</strong>
        <p>${labels[row.kind]} · ${status(row.status)}${manager() ? ' · ' + e(row.requested_by) : ''}</p>
        <p>${e(row.reason)}${row.minutes ? ' · ' + row.minutes + ' min' : ''}${row.proposed_start ? ' · ' + studioDay(row.proposed_start) + ' ' + time(row.proposed_start) : ''}
          ${row.proposed_name ? ' · ' + e(row.proposed_name) : ''}</p>
        ${row.review_note ? `<p>${e(row.review_note)}</p>` : ''}
        ${manager() && row.status === 'pending' ? `<div class="card-actions">${actionButton('Approve change', 'task-change-approve', 'check', 'primary', row.id)}
          ${actionButton('Reject change', 'task-change-reject', 'x', 'secondary', row.id)}</div>` : ''}</article>`).join('') : empty('No task change requests.')}
    </section>`;
  }

  function plansPage() {
    const date = selected();
    const own = state().plans.filter((plan) => plan.employee_id === actor().id && plan.work_day === date);
    const canStart = !own.some((plan) => ['draft', 'submitted', 'approved'].includes(plan.status)) && date >= ui.today();
    const plans = manager() ? state().plans : state().plans.filter((plan) => plan.work_day === date);
    const actions = `${canStart ? actionButton('New daily plan', 'daily-plan-edit', 'plus') : ''}
      ${manager() ? actionButton('Business audit', 'operations-audit', 'history', 'secondary') : ''}`;
    return `${heading('Daily plans', 'Review assignments and plan your work in IST.', `<div class="card-actions">${actions}</div>`)}
      <div class="operation-stack">
        ${planCalendar(date)}
        ${plans.length ? plans.map(planRow).join('') : `<section class="panel">${empty('No daily plans to show.')}</section>`}
        ${taskChanges()}
      </div>`;
  }

  function taskChangeForm(task) {
    const staff = state().assignableStaff.filter((person) => person.id !== task.employee_id);
    openDialog('Request task change', e(task.title), entryForm('operations/task-change', `
      <input type="hidden" name="taskId" value="${task.id}">
      <label class="full">Change<select name="kind" data-task-change-kind>
        <option value="extension">Time extension</option><option value="reschedule">New start time</option>
        ${staff.length ? '<option value="reassign">Reassign</option>' : ''}
      </select></label>
      <label data-change-field="extension">Additional minutes<input type="number" name="minutes" min="1" max="480" required></label>
      <label data-change-field="reschedule" hidden>Proposed start (IST)<input type="datetime-local" name="proposedDateTime" disabled required></label>
      <label data-change-field="reassign" hidden>Proposed employee<select name="employeeId" disabled required><option value="">Choose an employee</option>
        ${staff.map((person) => `<option value="${person.id}">${e(person.name)}</option>`).join('')}</select></label>
      <label class="full">Reason<textarea name="reason" maxlength="600" rows="3" required></textarea></label>
    `, 'Submit change'));
  }

  const actions = {
    'daily-plan-edit': planForm,
    'daily-plan-submit': (button, _value, id) => applyAction(button, 'operations/submit-plan', { id }, 'Plan submitted.'),
    'daily-plan-approve': (_button, _value, id) => reviewForm('operations/review-plan', 'id', id, 'Approve plan', 'approved'),
    'daily-plan-reject': (_button, _value, id) => reviewForm('operations/review-plan', 'id', id, 'Reject plan', 'rejected', true),
    'task-change-approve': (_button, _value, id) => reviewForm('operations/review-change', 'id', id, 'Approve change', 'approved'),
    'task-change-reject': (_button, _value, id) => reviewForm('operations/review-change', 'id', id, 'Reject change', 'rejected', true),
    'task-completion-approve': (_button, _value, id) => reviewForm('operations/completion', 'taskId', id, 'Approve completion', 'approve'),
    'task-completion-return': (_button, _value, id) => reviewForm('operations/completion', 'taskId', id, 'Return task', 'return', true),
    'task-change': (_button, _value, id) => taskChangeForm(taskById(id)),
    'submit-completion': (_button, _value, id) => openDialog('Submit work for review', e(taskById(id).title), entryForm('task-action', `
      <input type="hidden" name="taskId" value="${id}"><input type="hidden" name="action" value="submit-completion">
      <label class="full">Completion report or evidence reference<textarea name="report" maxlength="3000" rows="4" required>${e(state().taskDrafts.find((draft) => draft.task_id === id)?.completion)}</textarea></label>
      <label class="full">Attach evidence${taskById(id)?.evidence_required ? '' : ' (optional)'}<input name="evidence" type="file"
        accept="image/png,image/jpeg,application/pdf" ${taskById(id)?.evidence_required && !taskById(id)?.completion_file_id ? 'required' : ''}></label>
    `, 'Submit work')),
    'add-plan-entry': (button) => {
      const host = button.form.querySelector('.plan-entries');
      if (host.children.length >= 20) return;
      host.insertAdjacentHTML('beforeend', planEntry({}));
      host.lastElementChild.querySelector('input').focus();
    },
    'remove-plan-entry': (button) => {
      const entry = button.closest('[data-plan-entry]');
      if (entry.parentElement.children.length <= 1) return;
      (entry.nextElementSibling || entry.previousElementSibling).querySelector('input').focus();
      entry.remove();
    },
  };
  return {
    plansPage, actions, reset() { selectedDate = ''; interval = 'day'; },
    filters: {
      'plan-calendar-date': (value) => { if (validDay(value)) selectedDate = value; },
      'plan-calendar-interval': (value) => { interval = value; },
    },
  };
}
