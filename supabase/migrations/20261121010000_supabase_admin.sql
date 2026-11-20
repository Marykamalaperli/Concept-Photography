alter table concept.employees
  add column auth_user_id uuid unique references auth.users (id) on delete set null,
  add constraint admin_auth_user_only check (auth_user_id is null or is_admin = 1);

-- Authorization relinks the existing profile and its studio records in place.
create function concept.authorize_admin(admin_email text)
returns integer
language plpgsql
set search_path = pg_catalog
as $$
declare
  auth_id uuid;
  account_email text;
  display_name text;
  admin_id integer;
begin
  perform pg_advisory_xact_lock(1877142, 2701);

  select id, lower(email), left(nullif(btrim(raw_user_meta_data ->> 'full_name'), ''), 100)
  into auth_id, account_email, display_name
  from auth.users
  where lower(email) = lower(btrim(admin_email))
    and email_confirmed_at is not null
    and deleted_at is null
    and (banned_until is null or banned_until <= now());

  if auth_id is null then
    raise exception 'Add and confirm this email in Supabase Authentication before authorizing it.';
  end if;

  select id into admin_id
  from concept.employees
  where is_admin = 1 and archived = 0;

  if exists (
    select 1 from concept.employees
    where lower(email) = account_email and id is distinct from admin_id
  ) then
    raise exception 'That email already belongs to another studio profile. Choose a dedicated admin email.';
  end if;

  if admin_id is null then
    insert into concept.employees (name, role, email, color, is_admin, auth_user_id)
    values (coalesce(display_name, 'Studio Administrator'), 'Administrator', account_email, 'peach', 1, auth_id)
    returning id into admin_id;
  else
    update concept.employees set
      name = coalesce(display_name, name),
      email = account_email, auth_user_id = auth_id, password_hash = null
    where id = admin_id;

    delete from concept.auth_sessions where employee_id = admin_id;
  end if;

  return admin_id;
end;
$$;

revoke all on function concept.authorize_admin(text) from public, anon, authenticated, service_role;
