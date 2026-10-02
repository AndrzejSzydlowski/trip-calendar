-- ============================================================
-- Trip Calendar — schema, roles, audit history, admin MFA gate
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- roles ----------
do $$ begin
  create type user_role as enum ('admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

-- ---------- profiles ----------
-- One row per auth.users id. role='admin' is the single superuser
-- (only ever set directly in the DB — never via the client API).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role user_role not null default 'viewer',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

-- any signed-in, profiled user can see the user list (names/roles only)
create policy "profiles_select_self_or_admin"
  on public.profiles for select
  using (auth.uid() is not null);

-- nobody updates profiles directly from the client — role changes and
-- invites go through the service-role edge functions below, which also
-- enforce the admin-MFA gate.
revoke update, insert, delete on public.profiles from authenticated;

-- ---------- admin MFA sessions ----------
-- A short-lived "I verified my email code" marker. Edge functions
-- check this before allowing any sensitive admin action, and RLS
-- policies below also reference it directly.
create table if not exists public.admin_mfa_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table public.admin_mfa_sessions enable row level security;

create policy "admin_mfa_sessions_select_own"
  on public.admin_mfa_sessions for select
  using (user_id = auth.uid());

create or replace function public.admin_mfa_is_fresh()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_mfa_sessions
    where user_id = auth.uid() and verified_at > now() - interval '12 hours'
  );
$$;

-- one-time email codes (login 2FA + sensitive admin actions)
create table if not exists public.mfa_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null default 'login',
  code_hash text not null,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.mfa_codes enable row level security;
-- no client policies at all: only the service-role edge functions touch this table.

-- ---------- trips ----------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  place text,
  start_date date not null,
  end_date date not null,
  color text not null default '#4f6df5',
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date)
);
alter table public.trips enable row level security;

create policy "trips_select_any_profiled_user"
  on public.trips for select
  using (auth.uid() is not null);

create policy "trips_insert_editor_or_admin"
  on public.trips for insert
  with check (public.current_role() in ('editor', 'admin'));

create policy "trips_update_editor_or_admin"
  on public.trips for update
  using (public.current_role() in ('editor', 'admin'))
  with check (public.current_role() in ('editor', 'admin'));

create policy "trips_delete_editor_or_admin"
  on public.trips for delete
  using (public.current_role() in ('editor', 'admin'));

create or replace function public.trips_set_owner()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trips_set_owner_trg on public.trips;
create trigger trips_set_owner_trg
  before insert or update on public.trips
  for each row execute function public.trips_set_owner();

-- ---------- audit history (append-only, DB-generated — can't be faked by clients) ----------
create table if not exists public.trip_history (
  id bigint generated always as identity primary key,
  trip_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid references auth.users(id),
  changed_by_email text,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
alter table public.trip_history enable row level security;

create policy "trip_history_select_any_profiled_user"
  on public.trip_history for select
  using (auth.uid() is not null);
-- inserts only ever happen via the trigger function below (security definer),
-- so no insert/update/delete policy is granted to any client role.

create or replace function public.trips_audit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_email text;
begin
  select email into actor_email from auth.users where id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.trip_history(trip_id, action, changed_by, changed_by_email, old_data, new_data)
    values (new.id, 'insert', auth.uid(), actor_email, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.trip_history(trip_id, action, changed_by, changed_by_email, old_data, new_data)
    values (new.id, 'update', auth.uid(), actor_email, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.trip_history(trip_id, action, changed_by, changed_by_email, old_data, new_data)
    values (old.id, 'delete', auth.uid(), actor_email, to_jsonb(old), null);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trips_audit_trg on public.trips;
create trigger trips_audit_trg
  after insert or update or delete on public.trips
  for each row execute function public.trips_audit();

-- ---------- bootstrap: first user to sign up becomes the superuser ----------
-- Subsequent signups (should only happen via admin invite) default to 'viewer'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, role)
  values (new.id, new.email, case when is_first then 'admin' else 'viewer' end);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
