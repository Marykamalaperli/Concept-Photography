export const fenceRadius = 100;

const minute = 60_000;
const maxFixAge = 30_000;

export class AttendanceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function coordinatesAreValid({ latitude, longitude }) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function siteCoordinates(value) {
  const toNumber = (input) => typeof input === 'string' && input.trim() ? Number(input) : input;
  const coordinates = { latitude: toNumber(value.latitude), longitude: toNumber(value.longitude) };
  if (!coordinatesAreValid(coordinates)) throw new AttendanceError('Enter valid latitude and longitude for this location.');
  return coordinates;
}

export function shootSite(task) {
  const coordinates = { latitude: task.site_latitude, longitude: task.site_longitude };
  if (task.category !== 'Photo shoot' || !coordinatesAreValid(coordinates)) return null;
  return { name: task.location, ...coordinates, taskId: task.id };
}

export function assignedTo(task, employeeId) {
  return !task.is_open && (task.employee_id === employeeId || task.crew?.some((member) => member.employee_id === employeeId));
}

export function availableShoots(tasks, employeeId, now) {
  return tasks.filter((task) => assignedTo(task, employeeId) && (!task.shoot_status || task.shoot_status === 'booked') && !task.completed_at && shootSite(task) &&
    now >= task.start_at - 30 * minute && now < task.start_at + task.estimate * minute);
}

function verifyFix(value, now) {
  const { latitude, longitude, accuracy, capturedAt } = value ?? {};
  if (!coordinatesAreValid({ latitude, longitude }) || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new AttendanceError('A valid GPS location is required to record attendance.');
  }
  if (!Number.isFinite(capturedAt) || capturedAt < now - maxFixAge || capturedAt > now + maxFixAge) {
    throw new AttendanceError('The location reading is stale. Try again for a fresh GPS reading.');
  }
  return { latitude, longitude, accuracy };
}

function distanceMetres(first, second) {
  const radians = Math.PI / 180;
  const lat1 = first.latitude * radians;
  const lat2 = second.latitude * radians;
  const deltaLon = (first.longitude - second.longitude) * radians;
  const a = Math.sin((lat1 - lat2) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function presenceAt(location, site) {
  const distance = distanceMetres(location, site);
  if (location.accuracy <= 50) {
    if (distance + location.accuracy <= fenceRadius) return 'inside';
    if (distance - location.accuracy > fenceRadius) return 'outside';
  }
  return 'uncertain';
}

function assertInside(location, site) {
  const presence = presenceAt(location, site);
  if (presence === 'outside') throw new AttendanceError(`Move within ${fenceRadius} m of ${site.name} to record attendance.`, 422);
  if (presence === 'uncertain') {
    throw new AttendanceError('GPS could not verify that you are inside the boundary. Move closer to the site or try again with a clearer signal.', 422);
  }
}

export function returnSite(shift, office, tasks, employeeId, now) {
  if (!shift?.resume_pending || !shift.site) return null;
  const previous = JSON.parse(shift.site);
  const configured = previous.taskId
    ? availableShoots(tasks, employeeId, now).map(shootSite).find((site) => site.taskId === previous.taskId)
    : office;
  if (configured?.latitude !== previous.latitude || configured?.longitude !== previous.longitude) return null;
  return previous;
}

export function attendanceTransition({ command, latest, office, tasks, employeeId, now }) {
  const current = latest?.clock_out === null ? latest : null;

  if (command.action === 'cancel-return') {
    if (current || !latest?.resume_pending || command.shiftId !== latest.id) return null;
    return { type: 'cancel', shiftId: latest.id };
  }

  if (command.action === 'observe' && (!latest || command.shiftId !== latest.id)) return null;
  const location = verifyFix(command.location, now);
  const close = (reason) => ({ type: 'close', shiftId: current.id, location, reason, taskId: shiftSite?.taskId });
  const shiftSite = current?.site ? JSON.parse(current.site) : office;

  if (command.action === 'observe') {
    if (current) {
      if (current.site && presenceAt(location, shiftSite) === 'outside') return close('geofence');
      return null;
    }
    const site = returnSite(latest, office, tasks, employeeId, now);
    return site && presenceAt(location, site) === 'inside'
      ? { type: 'open', site, location, reason: 'geofence' }
      : null;
  }

  if (command.action === 'in' && !current) {
    const useShoot = command.taskId != null;
    const site = useShoot
      ? availableShoots(tasks, employeeId, now).map(shootSite).find((item) => item.taskId === Number(command.taskId))
      : office;
    if (!site) {
      if (useShoot) throw new AttendanceError('This shoot location is available only to its assignee during the scheduled check-in window.', 403);
      throw new AttendanceError('Ask the studio manager to set the office location.');
    }
    assertInside(location, site);
    return { type: 'open', site, location, reason: 'manual' };
  }

  if (command.action === 'out' && current && (command.shiftId == null || command.shiftId === current.id)) {
    if (!shiftSite) throw new AttendanceError('Ask the studio manager to set the office location.');
    assertInside(location, shiftSite);
    return close('manual');
  }

  throw new AttendanceError('The clock status changed. Refresh and try again.', 409);
}
