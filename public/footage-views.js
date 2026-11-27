const statuses = {
  unassigned: 'Needs assignee', assigned: 'Assigned', submitted: 'Awaiting review',
  incident: 'Issue reported', returned: 'Returned', approved: 'Verified',
};

export function createFootageViews(ui) {
  const { actor, state, manager, e, actionButton, heading, openDialog, entryForm, empty, day, time } = ui;
  const checkById = (id) => state().footageChecks.find((row) => row.id === id);

  function reviewForm(row, status) {
    const label = status === 'approved' ? 'Approve storage' : 'Return verification';
    openDialog(label, e(row.shoot_title), entryForm('footage/review', `
      <input type="hidden" name="id" value="${row.id}"><input type="hidden" name="status" value="${status}">
      <label class="full">Review note<textarea name="note" maxlength="1000" rows="3" ${status === 'returned' ? 'required' : ''}></textarea></label>`,
    label));
  }

  function form(row) {
    openDialog('Verify footage', e(row.shoot_title), entryForm('footage/submit', `
      <input type="hidden" name="id" value="${row.id}"><input type="hidden" name="taskId" value="${row.task_id}">
      <label class="full">Problem with footage<select name="incident">
        <option value="">Footage is available</option>
        <option value="missing"${row.incident === 'missing' ? ' selected' : ''}>Missing footage</option>
        <option value="corrupted"${row.incident === 'corrupted' ? ' selected' : ''}>Corrupted footage</option>
      </select></label>
      <label class="full">Storage drive<input name="drive" maxlength="100" value="${e(row.drive)}"></label>
      <label class="full">Folder path<input name="folder" maxlength="400" value="${e(row.folder)}"></label>
      <label class="full">Backup location<input name="backup" maxlength="400" value="${e(row.backup)}"></label>
      <label class="check-row"><input type="checkbox" name="transferred" ${row.transferred ? 'checked' : ''}> Transfer confirmed</label>
      <label class="check-row"><input type="checkbox" name="stored" ${row.stored ? 'checked' : ''}> Storage confirmed</label>
      <label class="full">Screenshot (PNG or JPEG)<input name="screenshot" type="file" accept="image/png,image/jpeg"></label>
      ${row.screenshot_id ? `<input type="hidden" name="existingScreenshot" value="${e(row.screenshot_id)}">` : ''}
      <label class="full">Notes<textarea name="note" maxlength="1000" rows="3">${e(row.note)}</textarea></label>`,
    'Submit verification'));
  }

  function managerForm() {
    const selected = state().hrSettings.storage_manager_id;
    openDialog('Data Storage Manager', 'New and open verifications go to the selected employee.',
      entryForm('footage/manager', `<label class="full">Employee<select name="employeeId"><option value="">No default assignee</option>
        ${state().employees.filter((person) => !person.is_admin && !person.deactivated && person.has_login)
          .map((person) => `<option value="${person.id}"${person.id === selected ? ' selected' : ''}>${e(person.name)}</option>`).join('')}
      </select></label>`, 'Save assignment'));
  }

  function historical() {
    const shots = state().tasks.filter((row) => row.category === 'Photo shoot' && row.completed_at && !row.footage_status);
    openDialog('Verify past shoots', 'Select completed shoots that still need storage verification.', shots.length ? entryForm('footage/historical', `
      <fieldset class="full settings-fields"><legend>Completed shoots</legend>
        ${shots.map((shot) => `<label class="check-row"><input type="checkbox" name="shoot" value="${shot.id}"> ${e(shot.title)} · ${day(shot.start_at)}</label>`).join('')}
      </fieldset>`, 'Create verifications') : empty('All completed shoots already have a verification.'));
  }

  function record(row) {
    return `<article class="panel operation-row">
      <header class="panel-head"><div><h2>${e(row.shoot_title)}</h2><p>${day(row.shoot_at)} · ${time(row.shoot_at)} IST · ${e(row.shoot_location)}</p></div>
        ${ui.tag(statuses[row.status], row.status === 'approved' ? 'sage' : row.status === 'incident' ? 'peach' : 'sand')}</header>
      <dl class="footage-fields">
        ${row.client_name ? `<div><dt>Client</dt><dd>${e(row.client_name)}${row.client_phone ? ' · ' + e(row.client_phone) : ''}</dd></div>` : ''}
        ${manager() ? `<div><dt>Storage manager</dt><dd>${e(row.manager_name || 'Unassigned')}</dd></div>` : ''}
        ${[['Storage drive', 'drive'], ['Folder path', 'folder'], ['Backup location', 'backup'], ['Problem', 'incident'], ['Notes', 'note'], ['Review note', 'review_note']]
          .filter(([_label, key]) => row[key]).map(([label, key]) => `<div><dt>${label}</dt><dd>${e(row[key])}</dd></div>`).join('')}
      </dl>
      ${row.screenshot_id ? `<p><a href="/api/files/${e(row.screenshot_id)}" class="text-link">Download screenshot</a></p>` : ''}
      <div class="card-actions">
        ${row.assigned_to === actor().id && ['assigned', 'returned', 'incident'].includes(row.status)
          ? actionButton('Verify footage', 'footage-verify', 'folder-check', 'primary', row.id) : ''}
        ${manager() && row.status === 'submitted' ? actionButton('Approve storage', 'footage-approve', 'check', 'primary', row.id) : ''}
        ${manager() && ['submitted', 'incident'].includes(row.status)
          ? actionButton('Return verification', 'footage-return', 'arrow-left', 'secondary', row.id) : ''}
      </div>
    </article>`;
  }

  function page() {
    const rows = state().footageChecks;
    return `${heading('Footage storage', 'Record where footage was transferred and verify its backup.',
      manager() ? `<div class="card-actions">${actionButton('Assign storage manager', 'footage-manager', 'user-round', 'secondary')}
        ${actionButton('Verify past shoots', 'footage-historical', 'archive', 'secondary')}</div>` : '')}
      <div class="operation-stack">${rows.length ? rows.map(record).join('') : `<section class="panel">${empty('No footage verifications assigned.')}</section>`}</div>`;
  }

  return {
    page,
    label: (status) => statuses[status],
    actions: {
      'footage-manager': managerForm,
      'footage-historical': historical,
      'footage-verify': (_button, _value, id) => form(checkById(id)),
      'footage-approve': (_button, _value, id) => reviewForm(checkById(id), 'approved'),
      'footage-return': (_button, _value, id) => reviewForm(checkById(id), 'returned'),
    },
  };
}
