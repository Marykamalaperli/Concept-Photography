export const projectAccessSql = `EXISTS (
  SELECT 1 FROM task_assignments a JOIN tasks t ON t.id = a.task_id
  LEFT JOIN tasks parent ON parent.id = t.parent_shoot_id
  WHERE a.employee_id = ? AND COALESCE(t.project_id, parent.project_id) = p.id AND t.is_open = 0 AND t.shoot_status != 'cancelled'
)`;
