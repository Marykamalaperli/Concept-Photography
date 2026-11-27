export function createRevenueViews(ui) {
  const { state, manager, actor, e, actionButton, heading, entryForm, openDialog, empty, table, today, day, money, duration } = ui;
  let report;
  let filters;
  let version = 0;

  function page() {
    const chosen = filters ?? { employeeId: actor().id, date: today(), period: 'month' };
    return `${heading('Revenue contribution', 'Allocated from the booked value of completed shoots. Payroll and cash receipts are tracked separately.')}
      <div class="operation-stack"><section class="panel">${entryForm('revenue/report', `
        ${manager() ? `<label class="full">Employee<select name="employeeId">${state().employees.map((person) =>
          `<option value="${person.id}"${person.id === Number(chosen.employeeId) ? ' selected' : ''}>${e(person.name)}</option>`).join('')}</select></label>` : ''}
        <label>Date (IST)<input type="date" name="date" required max="${today()}" value="${e(chosen.date)}"></label>
        <label>Period<select name="period">${[['day','Daily'],['week','Weekly'],['month','Monthly'],['all','All time']].map(([key,label]) =>
          `<option value="${key}"${chosen.period === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      `, 'Show contribution', false)}</section>
      ${report ? `<section class="panel"><div class="panel-head"><div><h2>${e(report.employee.name)}</h2>
        <p>${report.from ? e(report.from) + ' to ' + e(report.to) : 'All time'} · ${report.rows.length} completed shoots</p></div></div>
        <dl class="worksheet-totals"><div><dt>Contribution</dt><dd>${money(report.total)}</dd></div>
          <div><dt>Recorded project time</dt><dd>${duration(report.time)}</dd></div>
          <div><dt>Contribution per hour</dt><dd>${report.perHour == null ? '—' : money(report.perHour)}</dd></div></dl>
        ${report.rows.length ? table('Completed shoots', ['Shoot', 'Completed', 'Project time', 'Allocated value'], report.rows.map((row) =>
          [e(row.title), day(row.completed_at), duration(row.work_ms), row.amount_paise == null ? 'Awaiting allocation' : money(row.amount_paise)])) :
          empty('No completed shoots in this period.')}
      </section>` : ''}</div>`;
  }

  async function load(data, request) {
    const current = ++version;
    const result = await request('revenue/report', data);
    if (current !== version) return;
    filters = data;
    report = result;
    ui.render();
  }

  function allocationForm({ shoot, staff, entries }) {
    openDialog('Allocate revenue', e(shoot.title) + ' · ' + money(shoot.income_paise) + ' booked value', entryForm('revenue/save', `
      <input type="hidden" name="shootId" value="${shoot.id}">
      <p class="full">Leave the value blank for a person with no allocation.</p>
      ${staff.map((person) => {
        const row = entries.find((entry) => entry.employee_id === person.id);
        return `<fieldset class="plan-entry full form-grid">
          <legend>${e(person.name)}</legend>
          <input type="hidden" name="allocationEmployee" value="${person.id}">
          <label>Method<select name="allocationType"><option value="amount">Amount (INR)</option>
            <option value="percent"${row?.basis_points ? ' selected' : ''}>Percent</option></select></label>
          <label>Value<input name="allocationValue" type="number" min="0.01" step="0.01"
            value="${row ? (row.basis_points ?? row.amount_paise) / 100 : ''}"></label>
        </fieldset>`;
      }).join('')}`, 'Save allocations'));
  }

  return { page, load, allocationForm, reset() { report = undefined; filters = undefined; version++; } };
}
