export function createAuditViews(ui) {
  const { e, heading, actionButton, entryForm, empty, table, request, mutate, render, timeInput, state } = ui;
  let result;
  let filters = {};
  let generation = 0;

  async function load(next = filters) {
    const current = ++generation;
    const response = await request('audit/search', next);
    if (generation === current) {
      filters = next;
      result = response;
      render();
    }
  }

  function page() {
    return `${heading('Audit history', 'Search recorded account activity and business changes.')}
      <div class="operation-stack"><section class="panel">${entryForm('audit/search', `
        <label class="full">Search activity<input name="query" type="search" maxlength="100" value="${e(filters.query)}"
          placeholder="Action, record number or name"></label>
        <label>From (IST)<input name="from" type="date" value="${e(filters.from)}"></label>
        <label>To (IST)<input name="to" type="date" value="${e(filters.to)}"></label>
        <label>Record type<select name="subject"><option value="">All records</option>
          ${(result?.subjects ?? []).map((subject) =>
            `<option value="${e(subject)}"${subject === filters.subject ? ' selected' : ''}>${e(subject)}</option>`).join('')}</select></label>
        <label>Actor<select name="actorId"><option value="">All actors</option>
          ${state().employees.map((person) => `<option value="${person.id}"${person.id === Number(filters.actorId) ? ' selected' : ''}>${e(person.name)}</option>`).join('')}</select></label>
      `, 'Search history', false)}</section>
      <section class="panel">
        ${result?.rows.length ? table('Audit events', ['Time (IST)', 'Actor', 'Record', 'Action', 'Result', 'Changes'], result.rows.map((row) => [
          timeInput(row.occurred_at).replace('T', ' '), e(row.actor || 'System'), e(row.subject) + (row.record_id == null ? '' : ' #' + row.record_id),
          e(row.action), e(row.result), row.details !== '{}' ? `<details><summary>View changes</summary><pre class="audit-details">${e(JSON.stringify(JSON.parse(row.details), null, 2))}</pre></details>` : '—',
        ])) : empty(result ? 'No activity matches these filters.' : 'Search to load the most recent activity.')}
        ${result ? `<div class="card-actions"><span>Page ${result.page + 1}</span>
          ${result.page > 0 ? actionButton('Previous', 'audit-previous', 'arrow-left', 'secondary') : ''}
          ${result.more ? actionButton('Next', 'audit-next', 'arrow-right', 'secondary') : ''}</div>` : ''}
      </section></div>`;
  }

  return {
    page, load, reset() { result = undefined; filters = {}; generation++; },
    actions: {
      'audit-next': (button) => mutate(button, () => load({ ...filters, page: result.page + 1 })),
      'audit-previous': (button) => mutate(button, () => load({ ...filters, page: result.page - 1 })),
    },
  };
}
