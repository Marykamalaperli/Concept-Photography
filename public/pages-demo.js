const key = 'concept-pages-demo-v1';
const serializedFixture = new URL('demo-data.json', import.meta.url);
const studioDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const minute = 60_000;

function newDemo(fixture, now) {
  const midnight = Date.parse(studioDate.format(now) + 'T00:00:00+05:30');
  const taskOffset = midnight - fixture.anchor;
  const attendanceOffset = now - fixture.attendanceAnchor;
  return {
    employees: fixture.employees,
    tasks: fixture.tasks.map((task) => ({
      ...task,
      start_at: task.start_at + taskOffset,
      completed_at: task.completed_at === null ? null : task.completed_at + taskOffset,
    })),
    sessions: fixture.sessions.map((session) => ({
      ...session,
      start_at: session.start_at + taskOffset,
      end_at: session.end_at === null ? null : session.end_at + taskOffset,
    })),
    attendance: fixture.attendance.map((shift) => ({
      ...shift,
      clock_in: shift.clock_in + attendanceOffset,
      clock_out: shift.clock_out === null ? null : shift.clock_out + attendanceOffset,
    })),
    reminders: [],
  };
}

function addRow(rows, data) {
  const id = rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1;
  const row = { id, ...data };
  rows.push(row);
  return row;
}

function refreshReminders(state, now) {
  const notified = new Set(state.reminders.map((notice) => notice.task_id));
  for (const task of state.tasks) {
    if (!task.completed_at && task.start_at >= now && task.start_at <= now + 30 * minute && !notified.has(task.id)) {
      state.reminders.unshift({
        task_id: task.id, employee_id: task.employee_id, title: task.title,
        start_at: task.start_at, sent_at: now, read_at: null,
      });
    }
  }
}

function update(state, path, body, now) {
  if (path === 'employees') {
    const name = body.name.trim();
    const role = body.role.trim();
    const email = body.email.trim();
    if (!name || !role || !email) throw new Error('Enter a name, role, and email.');
    if (state.employees.some((person) => person.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('An employee with that email already exists.');
    }
    const colors = ['peach', 'lavender', 'sage', 'sand', 'rose'];
    const color = colors[state.employees.length % colors.length];
    return addRow(state.employees, { name, role, email, color });
  }

  const employeeId = Number(body.employeeId);
  if (!state.employees.some((person) => person.id === employeeId)) throw new Error('Employee not found.');

  if (path === 'tasks') {
    const title = body.title.trim();
    const location = body.location.trim();
    const estimate = Number(body.estimate);
    const start = Date.parse(body.startAt);
    if (!title || !location || !Number.isInteger(estimate) || estimate < 1 || estimate > 1440 || !Number.isFinite(start)) {
      throw new Error('Enter a valid task title, location, estimate, and start time.');
    }
    const task = addRow(state.tasks, {
      title, location, estimate, category: body.category, start_at: start,
      employee_id: employeeId, completed_at: null,
    });
    state.tasks.sort((left, right) => left.start_at - right.start_at);
    return task;
  }

  if (path === 'attendance') {
    const { latitude, longitude, accuracy } = body.location ?? {};
    if (![latitude, longitude, accuracy].every(Number.isFinite)) {
      throw new Error('A valid location is required to record attendance.');
    }
    const location = JSON.stringify({ latitude, longitude, accuracy });
    const shift = state.attendance.find((entry) => entry.employee_id === employeeId && entry.clock_out === null);
    if (body.action === 'in' && !shift) {
      const entry = addRow(state.attendance, {
        employee_id: employeeId, clock_in: now, in_location: location, clock_out: null, out_location: null,
      });
      state.attendance.sort((left, right) => right.clock_in - left.clock_in);
      return entry;
    }
    if (body.action === 'out' && shift) {
      shift.clock_out = now;
      shift.out_location = location;
      return shift;
    }
    throw new Error('The clock status changed. Refresh and try again.');
  }

  if (path === 'task-action') {
    const task = state.tasks.find((item) => item.id === body.taskId);
    if (!task || task.employee_id !== employeeId) throw new Error('Switch to the assigned employee to update this task.');
    if (task.completed_at) throw new Error('This task is already complete.');
    const active = state.sessions.find((entry) => entry.employee_id === employeeId && entry.end_at === null);
    if (body.action === 'start') {
      if (active) throw new Error('Pause the running task before starting another.');
      return addRow(state.sessions, { task_id: task.id, employee_id: employeeId, start_at: now, end_at: null });
    }
    if (body.action === 'pause' && active?.task_id === task.id) {
      active.end_at = now;
      return active;
    }
    if (body.action === 'complete') {
      if (active?.task_id === task.id) active.end_at = now;
      task.completed_at = now;
      return task;
    }
    throw new Error('This task action is unavailable.');
  }

  if (path === 'reminders/read') {
    for (const notice of state.reminders) {
      if (notice.employee_id === employeeId && !notice.read_at) notice.read_at = now;
    }
    return { ok: true };
  }
  throw new Error('This demo action is unavailable.');
}

async function run(path, body) {
  const snapshot = localStorage.getItem(key);
  const now = Date.now();
  let state;
  if (snapshot) {
    state = JSON.parse(snapshot);
  } else {
    const response = await fetch(serializedFixture);
    if (!response.ok) throw new Error('Could not load the demo data.');
    state = newDemo(await response.json(), now);
  }
  refreshReminders(state, now);
  const result = path === 'state' ? state : update(state, path, body, now);
  refreshReminders(state, now);
  const serialized = JSON.stringify(state);
  if (serialized !== snapshot) localStorage.setItem(key, serialized);
  return result;
}

export function demoRequest(path, body) {
  if (navigator.locks) return navigator.locks.request(key, () => run(path, body));
  return run(path, body);
}
