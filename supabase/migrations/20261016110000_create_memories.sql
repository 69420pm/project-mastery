-- The Memory the AI keeps per Course (#107): short notes on what helps it
-- tutor this Student, such as preferences and context, never mastery. One row
-- per Course, created on the first write. The Student reads and edits it on
-- the Brief page; it goes with its Course.

create table public.memories (
  course_id uuid primary key references public.courses (id) on delete cascade,
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 4000),
  updated_at timestamptz not null default now()
);

comment on table public.memories is 'What the AI noted about a Student in one Course to tutor them better. At most 4,000 characters; the Student can edit it.';

create index memories_owner_idx on public.memories (owner);

create trigger memories_set_updated_at
before update on public.memories
for each row execute function private.set_updated_at();

alter table public.memories enable row level security;

create policy "Students can read their own memory"
on public.memories for select to authenticated
using ((select auth.uid()) = owner);

-- Only for a Course of the Student's own.
create policy "Students can create the memory of their own Course"
on public.memories for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.courses
    where courses.id = memories.course_id
      and courses.owner = (select auth.uid())
  )
);

create policy "Students can edit their own memory"
on public.memories for update to authenticated
using ((select auth.uid()) = owner)
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.courses
    where courses.id = memories.course_id
      and courses.owner = (select auth.uid())
  )
);

-- Grant only what the policies allow: the owner is the database's. An upsert
-- (PostgREST) also sets `course_id` on conflict, so it is updatable too; the
-- update policy keeps it on the Student's own Course.
revoke all on table public.memories from anon, authenticated;
grant select on table public.memories to authenticated;
grant insert (course_id, text) on table public.memories to authenticated;
grant update (course_id, text) on table public.memories to authenticated;
