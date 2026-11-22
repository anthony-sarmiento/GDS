-- GDS (Geek'd Deployment System) database.
-- Paste this whole file into Supabase -> SQL Editor -> New query, then press Run.
-- It is safe to run again: everything uses "if not exists" / "create or replace".

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text not null default '',
  -- staff = retail side. lead / manager / owner = lead side (the full board).
  role       text not null default 'staff' check (role in ('staff', 'lead', 'manager', 'owner')),
  created_at timestamptz not null default now()
);

-- The Google profile picture, so the board can show faces next to names
alter table public.profiles add column if not exists avatar_url text;

-- Is the signed-in person an admin? Only admins can change anyone's role.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

-- Is the signed-in person on the lead side?
create or replace function public.is_lead()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('lead', 'manager', 'owner')
  );
$$;

-- Every new Google sign-in gets a profile. The first lead is set here by email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    case when lower(coalesce(new.email, '')) = 'antsarmiento440@gmail.com' then 'owner' else 'staff' end,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anyone who already signed in before this ran
insert into public.profiles (id, email, name, role, avatar_url)
select u.id,
       coalesce(u.email, ''),
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1)),
       case when lower(coalesce(u.email, '')) = 'antsarmiento440@gmail.com' then 'owner' else 'staff' end,
       coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

-- Pictures for accounts that already existed
update public.profiles p
set avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
where u.id = p.id and p.avatar_url is null;

-- Each person keeps their own picture up to date (only that one column, only their own row)
create or replace function public.save_my_avatar(p_url text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set avatar_url = nullif(left(p_url, 500), '') where id = auth.uid();
$$;
revoke all on function public.save_my_avatar(text) from public, anon;
grant execute on function public.save_my_avatar(text) to authenticated;

-- The first account is the admin ('owner' in the database), even if its profile was made some other way
update public.profiles set role = 'owner'
where lower(email) = 'antsarmiento440@gmail.com' and role <> 'owner';

-- ---------------------------------------------------------------------------
-- Saved people (so names are not typed again). `email` links a person to their Google account.
-- ---------------------------------------------------------------------------
create table if not exists public.team (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);
create unique index if not exists team_name_key on public.team (lower(name));

-- ---------------------------------------------------------------------------
-- One row per day: the board, assignments, break log and bathroom checks.
-- ---------------------------------------------------------------------------
create table if not exists public.days (
  date       text primary key,            -- 2026-11-22
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

-- Settings (staffing minimums, check reminder, walking time...). One row.
create table if not exists public.settings (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Break starts and stops that staff press on their own phones. The lead's screen applies them.
create table if not exists public.staff_events (
  id         bigint generated always as identity primary key,
  date       text not null,
  shift_id   text not null,
  break_id   text not null,
  kind       text not null check (kind in ('start', 'end')),
  at         int not null,                -- minutes on the operating-day clock
  user_id    uuid not null default auth.uid() references auth.users (id),
  applied    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists staff_events_open on public.staff_events (date) where not applied;

-- ---------------------------------------------------------------------------
-- Security: only the lead side can read or change the board. Staff see only what the functions below give them.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.team          enable row level security;
alter table public.days          enable row level security;
alter table public.settings      enable row level security;
alter table public.staff_events  enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid() or public.is_lead());
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid() and role = 'staff');
create policy profiles_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists team_all on public.team;
create policy team_all on public.team for all to authenticated using (public.is_lead()) with check (public.is_lead());

drop policy if exists days_all on public.days;
create policy days_all on public.days for all to authenticated using (public.is_lead()) with check (public.is_lead());

drop policy if exists settings_all on public.settings;
create policy settings_all on public.settings for all to authenticated using (public.is_lead()) with check (public.is_lead());

drop policy if exists events_read   on public.staff_events;
drop policy if exists events_update on public.staff_events;
create policy events_read   on public.staff_events for select to authenticated using (public.is_lead() or user_id = auth.uid());
create policy events_update on public.staff_events for update to authenticated using (public.is_lead()) with check (public.is_lead());

-- ---------------------------------------------------------------------------
-- Staff side
-- ---------------------------------------------------------------------------

-- The saved person a Google email belongs to. A person can have several emails (comma separated).
create or replace function public.member_name_for(p_email text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select t.name
  from public.team t
  where p_email <> ''
    and lower(p_email) = any (string_to_array(regexp_replace(lower(coalesce(t.email, '')), '\s', '', 'g'), ','))
  limit 1;
$$;

-- My shift today: only my own shift and my own board columns, plus my break presses the lead has not applied yet.
-- A person is matched to a shift by the name saved for their Google email (Team tab -> People).
create or replace function public.my_day(d text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me_name   text;
  me_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  day_data  jsonb;
  my_shifts jsonb;
  ids       text[];
begin
  if auth.uid() is null then
    return jsonb_build_object('linked', false);
  end if;

  select public.member_name_for(me_email) into me_name;
  if me_name is null then
    return jsonb_build_object('linked', false);
  end if;

  select data into day_data from public.days where date = d;

  select coalesce(jsonb_agg(s), '[]'::jsonb) into my_shifts
  from jsonb_array_elements(coalesce(day_data -> 'shifts', '[]'::jsonb)) s
  where lower(s ->> 'name') = lower(me_name);

  select coalesce(array_agg(s ->> 'id'), '{}') into ids
  from jsonb_array_elements(my_shifts) s;

  return jsonb_build_object(
    'linked', true,
    'name', me_name,
    'shifts', my_shifts,
    'cells', coalesce((
      select jsonb_object_agg(c.key, c.value)
      from jsonb_each(coalesce(day_data -> 'cells', '{}'::jsonb)) c
      where split_part(c.key, '@', 1) = any (ids)
    ), '{}'::jsonb),
    'settings', (select data from public.settings where id = 1),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('shift_id', e.shift_id, 'break_id', e.break_id, 'kind', e.kind, 'at', e.at) order by e.id)
      from public.staff_events e
      where e.date = d and not e.applied and e.shift_id = any (ids)
    ), '[]'::jsonb)
  );
end;
$$;

-- Start or end one of my breaks. Checks that the break really is mine.
create or replace function public.staff_break(d text, p_shift text, p_break text, p_kind text, p_at int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_name  text;
  me_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  ok       boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_kind not in ('start', 'end') then raise exception 'bad kind'; end if;

  select public.member_name_for(me_email) into me_name;
  if me_name is null then raise exception 'not linked to a team member'; end if;

  select exists (
    select 1
    from public.days dd,
         jsonb_array_elements(dd.data -> 'shifts') s,
         jsonb_array_elements(s -> 'breaks') b
    where dd.date = d
      and s ->> 'id' = p_shift
      and lower(s ->> 'name') = lower(me_name)
      and b ->> 'id' = p_break
  ) into ok;
  if not ok then raise exception 'that break is not yours'; end if;

  insert into public.staff_events (date, shift_id, break_id, kind, at, user_id)
  values (d, p_shift, p_break, p_kind, p_at, auth.uid());
end;
$$;

-- "I have clocked out", pressed on a staff phone. Only allowed once the lead has made Bumpout their assignment.
alter table public.staff_events drop constraint if exists staff_events_kind_check;
alter table public.staff_events add constraint staff_events_kind_check check (kind in ('start', 'end', 'bumpout'));

create or replace function public.staff_bumpout(d text, p_shift text, p_at int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me_name text;
  ok      boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select public.member_name_for(lower(coalesce(auth.jwt() ->> 'email', ''))) into me_name;
  if me_name is null then raise exception 'not linked to a team member'; end if;

  select exists (
    select 1
    from public.days dd, jsonb_array_elements(dd.data -> 'shifts') s
    where dd.date = d
      and s ->> 'id' = p_shift
      and lower(s ->> 'name') = lower(me_name)
      and s ? 'bumpoutAt'
      and (s ->> 'bumpoutAt')::int <= p_at
      and not (s ? 'sentHomeAt')
  ) into ok;
  if not ok then raise exception 'bumpout is not your assignment yet'; end if;

  insert into public.staff_events (date, shift_id, break_id, kind, at, user_id)
  values (d, p_shift, '', 'bumpout', p_at, auth.uid());
end;
$$;
revoke all on function public.staff_bumpout(text, text, int) from public, anon;
grant execute on function public.staff_bumpout(text, text, int) to authenticated;

revoke all on function public.my_day(text) from public, anon;
revoke all on function public.staff_break(text, text, text, text, int) from public, anon;
grant execute on function public.my_day(text) to authenticated;
grant execute on function public.staff_break(text, text, text, text, int) to authenticated;
grant execute on function public.is_lead() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Let the lead's screen hear about staff break presses right away
do $$
begin
  alter publication supabase_realtime add table public.staff_events;
exception when duplicate_object then null;
end $$;
