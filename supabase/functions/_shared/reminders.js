export function refreshReminders(db, now = Date.now()) {
  return db.run(`
    INSERT INTO reminders (task_id, employee_id, sent_at)
    SELECT id, employee_id, ? FROM tasks
    WHERE completed_at IS NULL AND is_open = 0 AND start_at BETWEEN ? AND ?
    ON CONFLICT (task_id) DO NOTHING
  `, now, now, now + 30 * 60_000);
}
