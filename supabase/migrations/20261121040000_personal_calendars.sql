create table concept.calendar_feeds (
  employee_id integer primary key references concept.employees(id) on delete cascade,
  token_hash text not null unique,
  created_at bigint not null,
  last_read_at bigint
);

alter table concept.calendar_feeds enable row level security;
revoke all on concept.calendar_feeds from public, anon, authenticated, service_role;

create function concept.revoke_calendar_on_identity_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  delete from concept.calendar_feeds where employee_id = old.id;
  return new;
end;
$$;
revoke all on function concept.revoke_calendar_on_identity_change() from public, anon, authenticated, service_role;

create trigger revoke_calendar_on_identity_change
after update of email, archived, auth_user_id on concept.employees
for each row when (
  old.email is distinct from new.email or old.archived is distinct from new.archived
  or old.auth_user_id is distinct from new.auth_user_id
)
execute function concept.revoke_calendar_on_identity_change();

alter table concept.tasks
  add column calendar_sequence integer not null default 0,
  add column calendar_updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint;

create function concept.update_task_calendar_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.calendar_sequence := old.calendar_sequence + 1;
  new.calendar_updated_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end;
$$;
revoke all on function concept.update_task_calendar_version() from public, anon, authenticated, service_role;

create trigger update_task_calendar_version
before update of title, employee_id, start_at, estimate, location, priority, is_open on concept.tasks
for each row when (
  row(old.title, old.employee_id, old.start_at, old.estimate, old.location, old.priority, old.is_open)
  is distinct from row(new.title, new.employee_id, new.start_at, new.estimate, new.location, new.priority, new.is_open)
)
execute function concept.update_task_calendar_version();
