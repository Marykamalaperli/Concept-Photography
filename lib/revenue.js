import { dayLength, dayStart, studioDay, validDay, weekday } from './hr-policy.js';
import { recordBusinessAudit } from './studio-notices.js';

export function installRevenueSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE revenue_allocations (
        shoot_id INTEGER NOT NULL REFERENCES tasks(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), basis_points INTEGER CHECK(basis_points BETWEEN 1 AND 10000),
        updated_by INTEGER NOT NULL REFERENCES employees(id), updated_at INTEGER NOT NULL, PRIMARY KEY(shoot_id, employee_id)
      ) STRICT;
      CREATE INDEX revenue_employee ON revenue_allocations(employee_id, shoot_id);
      PRAGMA user_version = 15;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createRevenue(db, { RequestError, idValue, paise }) {
  async function visibleShoot(store, shootId) {
    const shoot = await store.get("SELECT id, title, income_paise FROM tasks WHERE id = ? AND category = 'Photo shoot' AND completed_at IS NOT NULL", idValue(shootId));
    if (!shoot) throw new RequestError('Choose a completed shoot.', 404);
    return shoot;
  }

  const participants = (store, id) => store.all(`
    SELECT DISTINCT e.id, e.name
    FROM employees e JOIN task_assignments a ON a.employee_id = e.id JOIN tasks t ON t.id = a.task_id
    WHERE t.id = ? OR (t.parent_shoot_id = ? AND t.category = 'Editing') ORDER BY e.name
  `, id, id);

  function percent(input) {
    const parts = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(input ?? '').trim());
    const points = parts ? Number(parts[1]) * 100 + Number((parts[2] || '').padEnd(2, '0')) : 0;
    if (points <= 0 || points > 10_000) throw new RequestError('Enter a percentage greater than 0 and at most 100, using up to two decimals.');
    return points;
  }

  async function allocationDetails(body, actor) {
    if (!actor.is_admin) throw new RequestError('Revenue allocations are managed by administrators.', 403);
    const shoot = await visibleShoot(db, body.shootId);
    const [staff, entries] = await Promise.all([participants(db, shoot.id),
      db.all('SELECT employee_id, amount_paise, basis_points FROM revenue_allocations WHERE shoot_id = ?', shoot.id)]);
    return { shoot, staff, entries };
  }

  function save(body, actor, now) {
    if (!actor.is_admin) throw new RequestError('Revenue allocations are managed by administrators.', 403);
    if (!Array.isArray(body.allocations) || body.allocations.length > 52) throw new RequestError('Enter up to 52 employee allocations.');
    return db.transaction(async (store) => {
      const shoot = await visibleShoot(store, body.shootId);
      const staff = new Set((await participants(store, shoot.id)).map((row) => row.id));
      const seen = new Set();
      const entries = body.allocations.map((entry) => {
        if (!entry || typeof entry !== 'object' || !['amount','percent'].includes(entry.type)) throw new RequestError('Choose amount or percent for each allocation.');
        const employeeId = idValue(entry.employeeId);
        if (!staff.has(employeeId) || seen.has(employeeId)) throw new RequestError('Add each shoot participant at most once.');
        seen.add(employeeId);
        const basisPoints = entry.type === 'percent' ? percent(entry.value) : null;
        const amount = basisPoints ? Number(BigInt(shoot.income_paise) * BigInt(basisPoints) / 10_000n) : paise(entry.value);
        if (!amount) throw new RequestError('Choose an allocation of at least one paise.');
        return { employeeId, amount, basisPoints };
      });
      if (entries.reduce((total, row) => total + row.amount, 0) > shoot.income_paise ||
          entries.reduce((total, row) => total + (row.basisPoints ?? 0), 0) > 10_000) {
        throw new RequestError('Allocations cannot exceed the shoot value or 100 per cent.', 409);
      }
      const before = await store.all('SELECT employee_id, amount_paise, basis_points FROM revenue_allocations WHERE shoot_id = ?', shoot.id);
      await store.run('DELETE FROM revenue_allocations WHERE shoot_id = ?', shoot.id);
      for (const entry of entries) {
        await store.run(`
          INSERT INTO revenue_allocations(shoot_id, employee_id, amount_paise, basis_points, updated_by, updated_at) VALUES (?,?,?,?,?,?)
        `, shoot.id, entry.employeeId, entry.amount, entry.basisPoints, actor.id, now);
      }
      await recordBusinessAudit(store, actor.id, 'revenue allocation', shoot.id, 'allocations updated', now, { before, entries });
      return { ok: true };
    });
  }

  async function report(body, actor, now) {
    const employeeId = body.employeeId == null || body.employeeId === '' ? actor.id : idValue(body.employeeId);
    if (!actor.is_admin && employeeId !== actor.id) throw new RequestError('You can view only your own contribution.', 403);
    const employee = await db.get('SELECT id, name FROM employees WHERE id = ? AND archived = 0', employeeId);
    if (!employee) throw new RequestError('Employee not found.', 404);
    if (!validDay(body.date) || body.date > studioDay(now) || !['day','week','month','all'].includes(body.period)) {
      throw new RequestError('Choose a valid contribution period.');
    }
    const date = body.date;
    const anchor = dayStart(date);
    const start = {
      day: anchor, week: anchor - ((weekday(date) + 6) % 7) * dayLength, month: dayStart(date.slice(0, 7) + '-01'), all: 0,
    }[body.period];
    const end = Math.min(now + 1, {
      day: anchor + dayLength, week: start + 7 * dayLength,
      month: dayStart(studioDay(start + 32 * dayLength).slice(0, 7) + '-01'), all: now + 1,
    }[body.period]);
    const rows = await db.all(`
      SELECT t.id, t.title, t.completed_at, r.amount_paise,
        (SELECT COALESCE(SUM(s.end_at - s.start_at), 0) FROM task_sessions s
          JOIN tasks linked ON linked.id = s.task_id
          WHERE s.employee_id = ? AND (linked.id = t.id OR linked.parent_shoot_id = t.id)) AS work_ms
      FROM tasks t LEFT JOIN revenue_allocations r ON r.shoot_id = t.id AND r.employee_id = ?
      WHERE t.category = 'Photo shoot' AND t.completed_at >= ? AND t.completed_at < ?
        AND (r.employee_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM task_assignments a JOIN tasks linked ON linked.id = a.task_id
          WHERE a.employee_id = ? AND (linked.id = t.id OR linked.parent_shoot_id = t.id)
        ))
      ORDER BY t.completed_at DESC, t.id DESC
    `, employee.id, employee.id, start, end, employee.id);
    const total = rows.reduce((sum, row) => sum + (row.amount_paise ?? 0), 0);
    const time = rows.reduce((sum, row) => sum + row.work_ms, 0);
    return { employee, from: body.period === 'all' ? null : studioDay(start), to: studioDay(end - 1),
      rows, total, time, perHour: time ? Number(BigInt(total) * 3_600_000n / BigInt(time)) : null };
  }

  return { allocationDetails, save, report };
}
