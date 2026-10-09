-- Courses: what a Student studies for, one per exam (#37).

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- Trimmed by the app; the check refuses blank, padded or overlong names.
  -- Names need not be unique: a retake may reuse one.
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  -- Also touched when one of the Course's Chats gets a message, so the
  -- Course list sorts by recent use.
  updated_at timestamptz not null default now()
);

comment on table public.courses is 'A Course a Student studies for. Holds their Chats and Materials.';

create index courses_owner_updated_at_idx on public.courses (owner, updated_at desc);

create trigger courses_set_updated_at
before update on public.courses
for each row execute function private.set_updated_at();

-- Row Level Security: a Student reads and changes only their own Courses.
alter table public.courses enable row level security;

create policy "Students can read their own courses"
on public.courses
for select
to authenticated
using ((select auth.uid()) = owner);

create policy "Students can create their own courses"
on public.courses
for insert
to authenticated
with check ((select auth.uid()) = owner);

create policy "Students can update their own courses"
on public.courses
for update
to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

create policy "Students can delete their own courses"
on public.courses
for delete
to authenticated
using ((select auth.uid()) = owner);

-- Grant only what the policies allow. Only the name changes.
revoke all on table public.courses from anon, authenticated;
grant select, insert, delete on table public.courses to authenticated;
grant update (name) on table public.courses to authenticated;
