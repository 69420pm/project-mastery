-- Internal helpers live in a schema that the Data API does not expose, so
-- they cannot be called over HTTP.
create schema if not exists private;
revoke all on schema private from public;

-- Keeps `updated_at` current on every update.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;

-- One profile per auth user. Product data references `profiles.id`.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Public profile data for each auth user, created on signup.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- Row Level Security: a user sees and edits only their own profile. Rows are
-- created by the signup trigger and removed with the auth user, so there are
-- no insert or delete policies.
alter table public.profiles enable row level security;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Grant only what the policies allow. Users may change their display name,
-- never the id or timestamps.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

-- Creates the profile when Supabase Auth creates a user. Runs as the owner
-- (security definer) because the auth service role cannot write to `public`.
-- The display name comes from user-controlled signup metadata, so it is
-- trimmed and cut to the column limit instead of failing the signup.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 100)
  );
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();
