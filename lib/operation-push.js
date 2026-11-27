const minute = 60_000;
const updateWindow = 20 * minute;
const actionable = [
  'Emergency shoot assigned', 'Work assignment updated', 'Task assigned', 'Task needs rescheduling',
  'Daily plan approved', 'Daily plan rejected', 'Daily plan due by 6 PM', 'Daily plan overdue',
  'Task finishes soon', 'Task overdue', 'Task completion approved', 'Task returned for changes',
  'Lunch starts in five minutes', 'Scheduled lunch has started', 'Lunch ends in five minutes',
  'Break running longer than planned', 'Footage verification assigned', 'Footage incident reported',
  'Footage awaiting approval', 'Shift needs review', 'Shift review updated',
];

export function installOperationPushSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE push_subscriptions ADD COLUMN updates_enabled INTEGER NOT NULL DEFAULT 0 CHECK(updates_enabled IN (0, 1));
      CREATE TABLE operation_push_deliveries (
        notice_id INTEGER NOT NULL REFERENCES operation_notices(id) ON DELETE CASCADE,
        subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, sent_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(notice_id, subscription_id)
      ) STRICT;
      CREATE INDEX operation_push_due ON operation_push_deliveries(next_attempt_at) WHERE sent_at IS NULL;
      PRAGMA user_version = 20;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function claimOperationPush(db, now, maxAttempts) {
  return db.transaction(async (store) => {
    await store.run(`
      INSERT INTO operation_push_deliveries(notice_id, subscription_id, expires_at, next_attempt_at)
      SELECT n.id, s.id, n.created_at + ?, ?
      FROM operation_notices n JOIN push_subscriptions s ON s.employee_id = n.employee_id
      JOIN employees e ON e.id = n.employee_id
      WHERE s.updates_enabled = 1 AND n.read_at IS NULL AND n.created_at > ? AND n.created_at <= ?
        AND e.archived = 0 AND e.deactivated = 0
        AND n.title IN (${actionable.map(() => '?').join(', ')})
      ON CONFLICT(notice_id, subscription_id) DO NOTHING
    `, updateWindow, now, now - updateWindow, now, ...actionable);
    const due = await store.all(`
      SELECT d.notice_id, d.expires_at, d.subscription_id, n.employee_id, n.title,
        s.endpoint, s.p256dh, s.auth_secret
      FROM operation_push_deliveries d JOIN operation_notices n ON n.id = d.notice_id
      JOIN push_subscriptions s ON s.id = d.subscription_id AND s.employee_id = n.employee_id
      JOIN employees e ON e.id = n.employee_id
      WHERE d.sent_at IS NULL AND d.attempts < ? AND d.next_attempt_at <= ? AND d.expires_at > ?
        AND (n.title != 'Task finishes soon' OR EXISTS (
          SELECT 1 FROM tasks t JOIN task_assignments a ON a.task_id = t.id AND a.employee_id = n.employee_id
          WHERE t.id = n.task_id AND t.is_unscheduled = 0 AND t.completed_at IS NULL AND t.shoot_status = 'booked' AND t.work_state = 'ready'
            AND t.start_at + t.estimate * 60000 > ? AND n.event_key = 'finish:' || t.id || ':' || (t.start_at + t.estimate * 60000)
        ))
        AND n.read_at IS NULL AND s.updates_enabled = 1 AND e.archived = 0 AND e.deactivated = 0
      ORDER BY d.next_attempt_at, d.notice_id LIMIT 50
    `, maxAttempts, now, now, now);
    for (const row of due) {
      await store.run(`
        UPDATE operation_push_deliveries SET attempts = attempts + 1, next_attempt_at = ?
        WHERE notice_id = ? AND subscription_id = ?
      `, now + 2 * minute, row.notice_id, row.subscription_id);
    }
    await store.run('DELETE FROM operation_push_deliveries WHERE expires_at <= ?', now);
    return due;
  });
}
