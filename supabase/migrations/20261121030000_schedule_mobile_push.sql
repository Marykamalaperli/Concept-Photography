create extension if not exists pg_cron;
create extension if not exists pg_net;

create function concept.invoke_push_dispatch()
returns bigint
language sql
set search_path = pg_catalog
as $$
  select net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_token),
    timeout_milliseconds := 30000
  )
  from concept.push_settings
  where id = 1 and dispatch_url is not null;
$$;
revoke all on function concept.invoke_push_dispatch() from public, anon, authenticated, service_role;

select cron.schedule(
  'concept-mobile-reminders', '* * * * *', 'select concept.invoke_push_dispatch()'
);
