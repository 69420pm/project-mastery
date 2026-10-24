-- Pin and skip (#177): a Student pins a Topic to always have it in the study
-- plan, or skips it to never have it. One choice per Topic; choosing the
-- other one replaces it. The Student reads and writes their own rows, only
-- for Topics of their own Courses.

create table public.topic_choices (
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  choice text not null check (choice in ('pinned', 'skipped')),
  created_at timestamptz not null default now(),
  primary key (owner, topic_id)
);

comment on table public.topic_choices is 'A Student''s pin or skip of a Topic, which overrides the goal in the study plan.';

create index topic_choices_topic_id_idx on public.topic_choices (topic_id);

alter table public.topic_choices enable row level security;

create policy "Students can read their own topic choices"
on public.topic_choices for select to authenticated
using ((select auth.uid()) = owner);

-- Only for a Topic of the Student's own.
create policy "Students can choose on their own topics"
on public.topic_choices for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.topics
    where topics.id = topic_choices.topic_id
      and topics.owner = (select auth.uid())
  )
);

create policy "Students can change their own topic choices"
on public.topic_choices for update to authenticated
using ((select auth.uid()) = owner)
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.topics
    where topics.id = topic_choices.topic_id
      and topics.owner = (select auth.uid())
  )
);

create policy "Students can remove their own topic choices"
on public.topic_choices for delete to authenticated
using ((select auth.uid()) = owner);

-- The owner is the database's. An upsert (PostgREST) also sets `topic_id` on
-- conflict, so it is updatable too; the update policy keeps it on the
-- Student's own Topic.
revoke all on table public.topic_choices from anon, authenticated;
grant select, delete on table public.topic_choices to authenticated;
grant insert (topic_id, choice, created_at) on table public.topic_choices to authenticated;
grant update (topic_id, choice, created_at) on table public.topic_choices to authenticated;
