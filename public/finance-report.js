export function financeReport(state, month, today, studioDay) {
  const inPeriod = (date) => !month || date.slice(0, month.length) === month;
  const paid = new Map();
  for (const payment of state.payments) {
    paid.set(payment.task_id, (paid.get(payment.task_id) ?? 0) + payment.amount_paise);
  }
  const balances = state.tasks.filter((task) => task.category === 'Photo shoot').map((task) => {
    const received = paid.get(task.id) ?? 0;
    const cancelled = task.shoot_status === 'cancelled';
    const expected = cancelled ? received : task.income_paise;
    return { task, date: studioDay(task.start_at), received, expected, pending: expected - received, cancelled };
  });
  const overdue = balances.filter(({ task, pending }) => pending > 0 && task.payment_due_on && task.payment_due_on < today)
    .sort((first, second) => first.task.payment_due_on.localeCompare(second.task.payment_due_on));
  const shoots = balances.filter(({ date }) => inPeriod(date));
  const payments = state.payments.filter((entry) => inPeriod(entry.paid_on));
  const expenses = state.expenses.filter((entry) => inPeriod(entry.spent_on));
  const received = payments.reduce((sum, entry) => sum + entry.amount_paise, 0);
  const spent = expenses.reduce((sum, entry) => sum + entry.amount_paise, 0);
  const expected = shoots.reduce((sum, entry) => sum + entry.expected, 0);
  const outstanding = shoots.reduce((sum, entry) => sum + entry.pending, 0);
  return { shoots, payments, expenses, overdue, expected, received, spent, outstanding, net: received - spent };
}

export function monthlyCashTrend(payments, expenses, month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const months = new Map(Array.from({ length: 6 }, (_, index) => {
    const period = new Date(Date.UTC(year, monthNumber - 6 + index, 1)).toISOString().slice(0, 7);
    return [period, { period, received: 0, spent: 0 }];
  }));
  for (const payment of payments) {
    const totals = months.get(payment.paid_on.slice(0, 7));
    if (totals) totals.received += payment.amount_paise;
  }
  for (const expense of expenses) {
    const totals = months.get(expense.spent_on.slice(0, 7));
    if (totals) totals.spent += expense.amount_paise;
  }
  return [...months.values()].map((entry) => ({ ...entry, net: entry.received - entry.spent }));
}

function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^(?:[\s\uFEFF]*[=+\-@]|[\t\r\n])/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function financeCsv(report, month, tasks) {
  const rupees = (paise) => (paise / 100).toFixed(2);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rows = [
    ['Record', 'Date (IST)', 'Shoot or expense', 'Client', 'Category', 'Expected INR', 'Received INR',
      'Outstanding INR', 'Expense INR', 'Cash profit INR', 'Payment due date', 'Notes'],
    ['Report totals', month || 'All time', '', '', '', rupees(report.expected), rupees(report.received),
      rupees(report.outstanding), rupees(report.spent), report.net / 100, '', ''],
    ...report.shoots.map(({ task, date, expected, received, pending }) => [
      'Shoot balance', date, task.title, task.client_name, '', rupees(expected), rupees(received), rupees(pending),
      '', '', task.payment_due_on, '',
    ]),
    ...report.payments.map((entry) => [
      'Payment', entry.paid_on, byId.get(entry.task_id)?.title, byId.get(entry.task_id)?.client_name, entry.category || 'Shoot payment', '',
      rupees(entry.amount_paise), '', '', '', '', entry.note,
    ]),
    ...report.expenses.map((entry) => [
      'Expense', entry.spent_on, entry.name, '', entry.category, '', '', '', rupees(entry.amount_paise), '', '', entry.note,
    ]),
    ...report.overdue.map(({ task, pending }) => [
      'Overdue balance', '', task.title, task.client_name, '', '', '', rupees(pending), '', '', task.payment_due_on, '',
    ]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function financeGroups(report, tasks, projects) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const projectNames = new Map(projects.map((item) => [item.id, item.name]));
  function group(rows, label) {
    const totals = new Map();
    for (const row of rows) {
      const name = label(row);
      totals.set(name, (totals.get(name) ?? 0) + row.amount_paise);
    }
    return [...totals].sort((first, second) => second[1] - first[1]);
  }
  return [
    ['Receipts by client', group(report.payments, (row) => byId.get(row.task_id)?.client_name || 'No client')],
    ['Receipts by project', group(report.payments, (row) => projectNames.get(byId.get(row.task_id)?.project_id) || 'No project')],
    ['Receipts by category', group(report.payments, (row) => row.category || 'Shoot payment')],
    ['Expenses by category', group(report.expenses, (row) => row.category)],
  ];
}

export function cashReceiptComparison(payments, selectedPeriod, today) {
  const currentPeriod = selectedPeriod || today.slice(0, 7);
  const monthly = currentPeriod.length === 7;
  const [year, month] = currentPeriod.split('-').map(Number);
  const first = monthly ? currentPeriod + '-01' : currentPeriod + '-01-01';
  if (first > today) return null;
  const previousEnd = new Date(Date.UTC(monthly ? year : year - 1, monthly ? month - 1 : 12, 0)).toISOString().slice(0, 10);
  const previousPeriod = previousEnd.slice(0, currentPeriod.length);
  const ongoing = today.startsWith(currentPeriod);
  let previousCutoff = previousEnd;
  if (ongoing) {
    const comparisonMonth = monthly ? previousPeriod : previousPeriod + today.slice(4, 7);
    const [previousYear, previousMonth] = comparisonMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
    const cutoffDay = String(Math.min(Number(today.slice(-2)), lastDay)).padStart(2, '0');
    previousCutoff = comparisonMonth + '-' + cutoffDay;
  }

  let current = 0;
  let previous = 0;
  for (const entry of payments) {
    if (entry.paid_on.startsWith(currentPeriod) && entry.paid_on <= today) current += entry.amount_paise;
    if (entry.paid_on.startsWith(previousPeriod) && entry.paid_on <= previousCutoff) previous += entry.amount_paise;
  }
  return { currentPeriod, previousPeriod, current, previous, ongoing,
    growth: previous ? (current - previous) / previous : null };
}
