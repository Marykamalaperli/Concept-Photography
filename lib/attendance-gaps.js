export function refreshAttendanceGaps(db, now = Date.now(), shiftId) {
  return db.run(`
    INSERT INTO attendance_gaps (attendance_id, start_at)
    SELECT attendance.id, COALESCE(last_verified_at, clock_in)
    FROM attendance JOIN hr_settings ON hr_settings.id = 1
    WHERE clock_out IS NULL AND site IS NOT NULL
      AND COALESCE(last_verified_at, clock_in) <= ? - verification_grace_minutes * 60000
      ${shiftId ? 'AND attendance.id = ?' : ''}
    ON CONFLICT DO NOTHING
  `, now, ...(shiftId ? [shiftId] : []));
}

export async function endAttendanceGap(db, shiftId, now) {
  await refreshAttendanceGaps(db, now, shiftId);
  return db.run('UPDATE attendance_gaps SET resolved_at = ? WHERE attendance_id = ? AND resolved_at IS NULL', now, shiftId);
}
