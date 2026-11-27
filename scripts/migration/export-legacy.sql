\set ON_ERROR_STOP on
-- Run in a private directory with psql -X -A -t. This single read-only query
-- takes a consistent snapshot and leaves hosted authentication secrets behind.
SELECT jsonb_build_object(
  'format_version', 1,
  'tables', jsonb_build_object(
    'employees', (SELECT coalesce(jsonb_agg((to_jsonb(e) - 'auth_user_id') ||
      CASE WHEN e.is_admin = 1 THEN '{"password_hash":null}'::jsonb ELSE '{}'::jsonb END ORDER BY e.id), '[]') FROM concept.employees e),
    'office', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM concept.office r),
    'clients', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.clients r),
    'tasks', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.tasks r),
    'task_sessions', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.task_sessions r),
    'attendance', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.attendance r),
    'reminders', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM concept.reminders r),
    'work_requests', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.work_requests r),
    'payments', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.payments r),
    'expenses', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.expenses r),
    'hr_settings', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM concept.hr_settings r),
    'holidays', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM concept.holidays r),
    'hr_requests', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.hr_requests r),
    'work_logs', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.work_logs r),
    'payslips', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.payslips r),
    'announcements', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM concept.announcements r),
    'shoot_crew', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM concept.shoot_crew r)
  )
);
