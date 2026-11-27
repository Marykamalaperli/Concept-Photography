export const fenceRadius = 100;
export const maxAdditionalShootSites = 9;
export const maxFixAge = 30_000;
export const boundarySampleDelay = 1500;
export const boundarySampleAge = 15_000;

const minute = 60_000;

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

function shootSite(task) {
  const coordinates = { latitude: task.site_latitude, longitude: task.site_longitude };
  if (task.category !== 'Photo shoot' || !coordinatesAreValid(coordinates)) return null;
  return { name: task.location, ...coordinates, taskId: task.id };
}

export function additionalShootLocations(task) {
  return JSON.parse(task?.additional_sites ?? '[]');
}

export function officeSites(office) {
  if (!office) return [];
  const { additional_sites, ...primary } = office;
  return [primary, ...JSON.parse(additional_sites ?? '[]').map((site, index) => ({
    ...site, name: site.name || 'Office location ' + (index + 2), radius: primary.radius, maxAccuracy: primary.maxAccuracy,
  }))];
}

export function shootSites(task, policy = {}) {
  const primary = shootSite(task);
  if (!primary) return [];
  const sites = [primary, ...additionalShootLocations(task).map(({ name, latitude, longitude }, index) => ({
    name: name || `Location ${index + 2}`, latitude, longitude, taskId: task.id,
  }))];
  return sites.map((site) => ({ ...site, radius: policy.shoot_radius_m ?? fenceRadius, maxAccuracy: policy.max_accuracy_m ?? 50 }));
}

export function assignedTo(task, employeeId) {
  return !task.is_open && (task.employee_id === employeeId || task.crew?.some((member) => member.employee_id === employeeId));
}

export function availableShoots(tasks, employeeId, now) {
  return tasks.filter((task) => assignedTo(task, employeeId) && (!task.shoot_status || task.shoot_status === 'booked') && !task.completed_at && shootSite(task) &&
    now >= task.start_at - 30 * minute && now < task.start_at + task.estimate * minute);
}

export function verifyFix(value, now) {
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
  const radius = site.radius ?? fenceRadius;
  if (location.accuracy <= (site.maxAccuracy ?? 50)) {
    if (distance + location.accuracy <= radius) return 'inside';
    if (distance - location.accuracy > radius) return 'outside';
  }
  return 'uncertain';
}

function assertInside(location, site) {
  const presence = presenceAt(location, site);
  if (presence === 'outside') throw new AttendanceError(`Move within ${site.radius ?? fenceRadius} m of ${site.name} to record attendance.`, 422);
  if (presence === 'uncertain') {
    throw new AttendanceError('GPS could not verify that you are inside the boundary. Move closer to the site or try again with a clearer signal.', 422);
  }
}

export function returnSite(shift, office, tasks, employeeId, now, policy) {
  if (!shift?.resume_pending || !shift.site) return null;
  const previous = JSON.parse(shift.site);
  const sites = previous.taskId
    ? availableShoots(tasks, employeeId, now).filter((task) => task.id === previous.taskId).flatMap((task) => shootSites(task, policy))
    : officeSites(office);
  return sites.find((site) => site.latitude === previous.latitude && site.longitude === previous.longitude) ?? null;
}

export function attendanceTransition({ command, latest, office, tasks, employeeId, now, policy }) {
  const current = latest?.clock_out === null ? latest : null;

  if (command.action === 'cancel-return') {
    if (current || !latest?.resume_pending || command.shiftId !== latest.id) return null;
    return { type: 'cancel', shiftId: latest.id };
  }

  if (['observe', 'verify'].includes(command.action) && (!latest || command.shiftId !== latest.id)) return null;
  const location = verifyFix(command.location, now);
  const close = (reason) => ({ type: 'close', shiftId: current.id, location, reason, taskId: shiftSite?.taskId });
  const shiftSite = current?.site ? JSON.parse(current.site) : office;

  if (command.action === 'verify') {
    return current?.site && presenceAt(location, shiftSite) === 'inside' ? { type: 'verify', shiftId: current.id } : null;
  }

  if (command.action === 'observe') {
    if (current) {
      if (current.site && presenceAt(location, shiftSite) === 'outside') return close('geofence');
      return null;
    }
    const site = returnSite(latest, office, tasks, employeeId, now, policy);
    return site && presenceAt(location, site) === 'inside'
      ? { type: 'open', site, location, reason: 'geofence' }
      : null;
  }

  if (command.action === 'in' && !current) {
    const useShoot = command.taskId != null;
    const sites = useShoot
      ? availableShoots(tasks, employeeId, now).filter((task) => task.id === Number(command.taskId)).flatMap((task) => shootSites(task, policy))
      : officeSites(office);
    const site = sites.sort((left, right) => distanceMetres(location, left) - distanceMetres(location, right))[0];
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
