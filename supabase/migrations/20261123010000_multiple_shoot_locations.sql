alter table concept.tasks add column additional_sites text not null default '[]'
  check (jsonb_typeof(additional_sites::jsonb) = 'array');

drop trigger update_task_calendar_version on concept.tasks;
create trigger update_task_calendar_version
before update of title, employee_id, start_at, estimate, location, priority, is_open, shoot_status, additional_sites on concept.tasks
for each row when (
  row(old.title, old.employee_id, old.start_at, old.estimate, old.location, old.priority, old.is_open, old.shoot_status, old.additional_sites)
  is distinct from row(new.title, new.employee_id, new.start_at, new.estimate, new.location, new.priority, new.is_open, new.shoot_status, new.additional_sites)
)
execute function concept.update_task_calendar_version();
