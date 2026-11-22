alter table concept.tasks
  add column parent_shoot_id integer references concept.tasks(id),
  add column delivery_due_at bigint,
  add column payment_due_on text;

create unique index one_editing_schedule_per_shoot on concept.tasks (parent_shoot_id)
  where parent_shoot_id is not null;

alter table concept.push_subscriptions add column last_test_at bigint;
