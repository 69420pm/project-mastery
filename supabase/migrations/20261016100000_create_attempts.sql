-- The evidence a Student gives on each KC in a Chat (#103): one row per KC
-- per problem or review question, recorded by the AI's `recordAttempt` tool
-- as the Student. It is the only stored learner state: code replays a KC's
-- attempts into its level and next review
-- (src/features/study/domain/ladder.ts). The log is immutable: a Student
-- reads and adds their own rows, never changes them, and they go with their
-- Course or KC.

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  kc_id uuid not null references public.kcs (id) on delete cascade,
  -- The Exercise the problem came from; null for a review question.
  exercise_id uuid references public.exercises (id) on delete set null,
  correct boolean not null,
  -- How much the AI helped: none, some, or it showed the solution.
  help text not null check (help in ('none', 'some', 'solution_shown')),
  created_at timestamptz not null default now()
);

comment on table public.attempts is 'The evidence for one KC from one problem or review question in a Chat. Immutable; replayed into the KC''s review ladder.';

create index attempts_kc_id_created_at_idx on public.attempts (kc_id, created_at);
create index attempts_course_id_idx on public.attempts (course_id);
create index attempts_owner_idx on public.attempts (owner);
create index attempts_exercise_id_idx on public.attempts (exercise_id);

alter table public.attempts enable row level security;

create policy "Students can read their own attempts"
on public.attempts for select to authenticated
using ((select auth.uid()) = owner);

-- Only on a KC, and an Exercise, of the Student's own Course.
create policy "Students can record attempts on their own KCs"
on public.attempts for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.kcs
    where kcs.id = attempts.kc_id
      and kcs.course_id = attempts.course_id
      and kcs.owner = (select auth.uid())
  )
  and (
    exercise_id is null
    or exists (
      select 1 from public.exercises
      where exercises.id = attempts.exercise_id
        and exercises.course_id = attempts.course_id
    )
  )
);

-- Grant only what the policies allow. The owner and the time are the
-- database's, so attempts cannot be backdated, and rows are never changed.
revoke all on table public.attempts from anon, authenticated;
grant select on table public.attempts to authenticated;
grant insert (course_id, kc_id, exercise_id, correct, help)
  on table public.attempts to authenticated;
