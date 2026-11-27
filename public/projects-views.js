export function createProjectViews(ui) {
  const { state, manager, e, actionButton, heading, entryForm, openDialog, empty, table, day, time, money, applyAction } = ui;
  let search = '';
  let category = '';
  const kinds = { document: 'Document', reference: 'Reference', delivery: 'Delivery' };

  function page() {
    const all = state().projects;
    const categories = [...new Set(all.map((row) => row.category))].sort();
    const matches = all.filter((row) => (!category || row.category === category) &&
      [row.name, row.client_name, row.category].some((text) => text.toLowerCase().includes(search.toLowerCase())));
    return `${heading('Projects', manager() ? 'Organize client bookings, project resources and delivery links.' : 'Find resources and delivery links for your assigned projects.',
      manager() ? actionButton('Add project', 'project-new', 'plus') : '')}
      <section class="panel"><div class="operation-toolbar">
        <label>Search projects<input type="search" id="project-search" value="${e(search)}" placeholder="Name or client"></label>
        <label>Category<select id="project-category"><option value="">All categories</option>
          ${categories.map((item) => `<option value="${e(item)}"${item === category ? ' selected' : ''}>${e(item)}</option>`).join('')}
        </select></label>
      </div>
      ${matches.length ? table('Projects', ['Project', 'Category', 'Client', 'Actions'], matches.map((row) =>
        [e(row.name), e(row.category), e(row.client_name), actionButton('View project', 'project-detail', 'arrow-right', 'secondary', row.id)])) :
        empty(all.length ? 'No projects match your filters.' : 'No projects to display.')}</section>`;
  }

  function form(project) {
    openDialog(project ? 'Edit project' : 'Add project', '', entryForm('projects', `
      ${project ? `<input type="hidden" name="id" value="${project.id}">` : `<label class="full">Client<select name="clientId" required>
        <option value="">Choose a client</option>${state().clients.map((row) => `<option value="${row.id}">${e(row.name)}</option>`).join('')}
      </select></label>`}
      <label class="full">Project name<input name="name" maxlength="100" required value="${e(project?.name)}"></label>
      <label class="full">Project category<input name="category" maxlength="100" required value="${e(project?.category)}"></label>
      <label class="full">Description<textarea name="description" maxlength="1600" rows="4">${e(project?.description)}</textarea></label>`, 'Save project'));
  }

  function resourceForm({ project, files }) {
    openDialog('Add resource', e(project.name), entryForm('projects/resource', `
      <input type="hidden" name="projectId" value="${project.id}">
      <label class="full">Title<input name="title" maxlength="100" required></label>
      <label class="full">Type<select name="kind">${Object.entries(kinds).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <label class="full">HTTPS link<input type="url" name="url" maxlength="2048"></label>
      <label class="full">Or choose an uploaded client file<select name="fileId"><option value="">No attachment</option>
        ${files.map((file) => `<option value="${e(file.id)}">${e(file.name)}</option>`).join('')}
      </select></label>`, 'Save resource'));
  }

  function detail({ project, shoots, participants, resources, days, payments, booked, received, outstanding }) {
    const people = (id, type) => participants.filter((row) => row.shoot_id === id && row.category === type).map((row) => e(row.name)).join(', ') || '—';
    openDialog(e(project.name), e(project.client_name) + ' · ' + e(project.category), `<div class="operation-stack">
      ${project.description ? `<p class="project-description">${e(project.description)}</p>` : ''}
      <div class="card-actions">
      ${manager() ? actionButton('Edit project', 'project-edit', 'pencil', 'secondary', project.id)
        + actionButton('Add resource', 'project-resource', 'plus', 'secondary', project.id)
        + actionButton('Upload client file', 'client-files', 'paperclip', 'secondary', project.client_id) : ''}</div>
      <div><h3>Resources</h3>${resources.length ? resources.map((row) => `<article class="notice-row">
        <div><a class="text-link" rel="noopener noreferrer" ${row.url ? 'target="_blank"' : ''} href="${e(row.url || '/api/files/' + row.file_id)}">${e(row.title)}</a>
          <p>${kinds[row.kind]}${row.file_name ? ' · ' + e(row.file_name) : ''}</p></div>
        ${manager() ? `<button type="button" class="btn secondary" data-action="project-resource-remove" data-id="${row.id}" data-value="${project.id}">Remove resource</button>` : ''}
      </article>`).join('') : empty('No project resources shared.')}</div>
      <div><h3>Bookings · ${days} shoot ${days === 1 ? 'day' : 'days'}</h3>
        ${shoots.length ? table('Project shoots', ['Shoot', 'Schedule (IST)', 'Location', 'Crew', 'Editors', 'Status'], shoots.map((row) =>
          [e(row.title), day(row.start_at) + ' · ' + time(row.start_at), e(row.location), people(row.id, 'Photo shoot'), people(row.id, 'Editing'),
            e(row.completed_at ? 'Done' : row.shoot_status)])) : empty('Link a shoot to this project when scheduling it.')}</div>
      ${manager() ? `<div><h3>Project payments</h3>
        <dl class="worksheet-totals"><div><dt>Booked</dt><dd>${money(booked)}</dd></div>
          <div><dt>Received</dt><dd>${money(received)}</dd></div><div><dt>Outstanding</dt><dd>${money(outstanding)}</dd></div></dl>
        ${payments.length ? table('Project payment history', ['Date', 'Shoot', 'Received', 'Note'], payments.map((row) =>
          [e(row.paid_on), e(shoots.find((shoot) => shoot.id === row.task_id)?.title), money(row.amount_paise), e(row.note || '—')])) : empty('No payments recorded.')}</div>` : ''}
    </div>`);
  }

  const load = async (id) => ui.request('projects/detail', { id });
  return {
    page,
    actions: {
      'project-new': () => form(),
      'project-detail': (button, _value, id) => ui.mutate(button, async () => detail(await load(id))),
      'project-edit': (button, _value, id) => ui.mutate(button, async () => form((await load(id)).project)),
      'project-resource': (button, _value, id) => ui.mutate(button, async () => resourceForm(await load(id))),
      'project-resource-remove': (button, value, id) => applyAction(button, 'projects/resource', { id, projectId: value, remove: true }, 'Resource removed.', true),
    },
    filters: {
      'project-search': (value) => { search = value.trim(); },
      'project-category': (value) => { category = value; },
    },
    reset() { search = ''; category = ''; },
  };
}
