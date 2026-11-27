export function refreshReminders(db, now = Date.now()) {
  return db.run(`
    INSERT INTO reminders (task_id, employee_id, sent_at)
    SELECT tasks.id, task_assignments.employee_id, ? FROM tasks
    JOIN task_assignments ON tasks.id = task_assignments.task_id
    JOIN employees ON employees.id = task_assignments.employee_id AND employees.archived = 0 AND employees.deactivated = 0
    WHERE completed_at IS NULL AND is_open = 0 AND shoot_status = 'booked' AND work_state = 'ready' AND is_unscheduled = 0 AND start_at BETWEEN ? AND ?
    ON CONFLICT (task_id, employee_id) DO NOTHING
  `, now, now, now + 30 * 60_000);
}
