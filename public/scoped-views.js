export const businessLabels = {
  'create-clients': 'Create clients', 'edit-clients': 'Edit client profiles', 'manage-clients': 'View scoped client records',
  'create-projects': 'Create projects for scoped clients', 'edit-projects': 'Edit scoped projects',
  'manage-projects': 'View scoped project operations', 'schedule-shoots': 'Schedule project shoots',
  'assign-crew': 'Assign project shoot crew', 'assign-tasks': 'Assign project tasks',
  'manage-resources': 'Manage project resources', 'manage-attachments': 'Manage scoped attachments',
  'view-project-reports': 'View scoped project payment reports',
};

export function createScopedViews(ui) {
  const { actor, state, e, icon, heading, actionButton, entryForm, openDialog, table, empty, request, mutate, timeInput, render } = ui;
  let data;
  let requestId = 0;
  const can = (permission) => actor().is_admin || actor().permissions.includes(permission);

  async function load() {
    const current = ++requestId;
    const result = await request('scoped-work');
    if (current === requestId) { data = result; render(); }
  }

  function page() {
    const actions = actionButton(data ? 'Refresh records' : 'Load records', 'scope-load', 'refresh-cw', 'secondary') +
      (can('create-clients') ? actionButton('Add client', 'scope-new-client', 'plus') : '') +
      (data?.clients.length && can('create-projects') ? actionButton('Add project', 'scope-new-project', 'plus') : '');
    return `${heading('Client and project desk', 'Manage the clients and projects assigned to you.', `<div class="card-actions">${actions}</div>`)}
      ${data ? `<div class="operation-stack">
        <section class="panel"><h2>Clients</h2>${data.clients.length ? table('Scoped clients', ['Client', 'Contact', 'Actions'],
          data.clients.map((row) => [e(row.name), e(row.email || row.phone || '—'), `<div class="card-actions">
          ${can('edit-clients') ? actionButton('Edit client', 'scope-edit-client', 'pencil', 'secondary', row.id) : ''}
          ${can('manage-attachments') ? actionButton('Client files', 'client-files', 'paperclip', 'secondary', row.id) : ''}
          </div>`])) : empty('No clients in your scope.')}</section>
        <section class="panel"><h2>Projects</h2>${data.projects.length ? table('Scoped projects', ['Project', 'Client', 'Actions'],
          data.projects.map((row) => [e(row.name), e(row.client_name), `<div class="card-actions">
          ${actionButton('View project', 'project-detail', 'arrow-right', 'secondary', row.id)}
          ${can('schedule-shoots') ? actionButton('Schedule shoot', 'scope-shoot', 'camera', 'secondary', row.id) : ''}
          ${can('assign-tasks') ? actionButton('Assign task', 'scope-task', 'plus', 'secondary', row.id) : ''}
          </div>`])) : empty('No projects in your scope.')}</section>
        <section class="panel"><h2>Project assignments</h2>${data.tasks.length ? table('Project assignments', ['Work', 'Type', 'Actions'],
          data.tasks.map((row) => [e(row.title), e(row.category), !row.completed_at ?
            (row.category === 'Photo shoot' ? can('schedule-shoots') : can('assign-tasks')) ?
              actionButton('Edit assignment', 'scope-edit-task', 'pencil', 'secondary', row.id) : '' : 'Completed'])) :
          empty('No assignments in your scope.')}</section></div>` : `<section class="panel">${empty('Load your assigned records to begin.')}</section>`}`;
  }

  async function scopesForm(employeeId) {
    const employee = state().employees.find((row) => row.id === employeeId);
    const current = await request('scopes');
    const granted = (list) => list.filter((entry) => entry.employee_id === employeeId).map((entry) => entry.recordId);
    openDialog('Client and project access', e(employee.name), `
      <div class="operation-stack">${['client', 'project'].map((kind) => {
        const list = state()[kind + 's'];
        const active = granted(current[kind + 's']);
        const options = list.map((row) => `<option value="${row.id}">${e(row.name)}${active.includes(row.id) ? ' · access granted' : ''}</option>`).join('');
        return `<section class="scope-grant"><h3>${kind === 'client' ? 'Clients and their projects' : 'Individual projects'}</h3>
          ${list.length ? entryForm('scopes', `
            <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="kind" value="${kind}">
            <label>${kind === 'client' ? 'Client' : 'Project'}<select name="recordId">${options}</select></label>
            <label>Access<select name="enabled"><option value="true">Grant</option><option value="false">Revoke</option></select></label>
            <label class="full">Reason <input name="reason" maxlength="350"></label>`, 'Save ' + kind + ' access', false) : empty('No records available.')}
          </section>`;
      }).join('')}</div>`);
  }

  function assignment(projectId, shoot, existing) {
    const project = data.projects.find((row) => row.id === projectId);
    const people = data.people;
    const crew = existing ? JSON.parse(existing.crew) : [];
    const showPeople = shoot ? can('assign-crew') : can('assign-tasks');
    const priorEnd = existing ? existing.start_at + existing.estimate * 60_000 : null;
    openDialog(existing ? 'Edit assignment' : shoot ? 'Schedule shoot' : 'Assign task', e(project.name), entryForm('tasks', `
      <input type="hidden" name="delegated" value="true"><input type="hidden" name="projectId" value="${projectId}">
      ${existing ? `<input type="hidden" name="id" value="${existing.id}">` : ''}
      <label class="full">Title<input name="title" required maxlength="100" value="${e(existing?.title)}"></label>
      ${shoot || existing ? `<input type="hidden" name="category" value="${e(existing?.category || 'Photo shoot')}">` :
        '<label class="full">Work type<select name="category"><option>Editing</option><option>Planning</option><option>Studio</option><option>Other</option></select></label>'}
      ${showPeople ? `<label class="full">${shoot ? 'Shoot lead' : 'Employee'}<select name="employeeId" required>
        <option value="">Choose an employee</option>${people.map((row) =>
          `<option value="${row.id}"${row.id === existing?.employee_id ? ' selected' : ''}>${e(row.name)}</option>`).join('')}</select></label>` : ''}
      ${shoot ? `<label>Starts (IST)<input name="shootFrom" type="datetime-local" required value="${existing ? timeInput(existing.start_at) : ''}"></label>
        <label>Ends (IST)<input name="shootTo" type="datetime-local" required value="${priorEnd ? timeInput(priorEnd) : ''}"></label>
        <label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required value="${e(existing?.site_latitude)}"></label>
        <label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required value="${e(existing?.site_longitude)}"></label>
        ${showPeople ? `<fieldset class="full crew-fields"><legend>Additional crew</legend><div class="hr-crew-options">
          ${people.map((row) => `<label><input name="crew" type="checkbox" value="${row.id}"${crew.includes(row.id) ? ' checked' : ''}>${e(row.name)}</label>`).join('')}
          </div></fieldset>` : ''}` :
        `<label>Date (IST)<input name="startDate" type="date" required value="${existing ? timeInput(existing.start_at).slice(0,10) : ''}"></label>
        <label>Start (IST)<input name="startTime" type="time" required value="${existing ? timeInput(existing.start_at).slice(11) : ''}"></label>
        <label class="full">Estimate, minutes<input name="estimate" type="number" min="1" max="1440" required value="${existing?.estimate ?? 60}"></label>`}
      <label class="full">Location<input name="location" required maxlength="100" value="${e(existing?.location)}"></label>
      <label class="full">Reason or scheduling note <input name="reason" maxlength="350"></label>`, 'Save assignment'));
  }

  return {
    page, load, reset() { data = undefined; requestId++; },
    actions: {
      'scope-load': (button) => mutate(button, load),
      'scope-access': (button, _value, id) => mutate(button, () => scopesForm(id)),
      'scope-new-client': () => ui.clientForm(),
      'scope-edit-client': (_button, _value, id) => ui.clientForm(data.clients.find((row) => row.id === id)),
      'scope-new-project': () => ui.projectForm(undefined, data.clients),
      'scope-shoot': (_button, _value, id) => assignment(id, true),
      'scope-task': (_button, _value, id) => assignment(id, false),
      'scope-edit-task': (_button, _value, id) => {
        const row = data.tasks.find((task) => task.id === id);
        assignment(row.project_id, row.category === 'Photo shoot', row);
      },
    },
  };
}
