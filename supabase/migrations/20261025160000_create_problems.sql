-- Tutoring M5b (#183): generated Problems. When a Topic's Exercises run
-- short, the generate workflow queues and writes Problems of the Course:
-- variants of its Exercises and new Problems, whose numbers come from a
-- program. `findProblems` gives the tutor the ready, unflagged ones beside
-- the unseen Exercises, and a question can pose one. Only the workflow
-- (service role) writes Problems; a Student reads their own and may flag a
-- ready one once, which takes it out of the pool.

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  source text not null check (source in ('variant', 'new')),
  status text not null default 'queued' check (status in ('queued', 'ready', 'failed')),
  -- The Topic whose stock it was queued for; null for review stock.
  topic_id uuid references public.topics (id) on delete set null,
  -- The Exercise a variant varies; null for a new Problem, and once that
  -- Exercise is gone.
  original_exercise_id uuid references public.exercises (id) on delete set null,
  -- A variant's is its Exercise's; null when there is none.
  task_type text check (char_length(task_type) between 1 and 200),
  difficulty smallint not null check (difficulty between 1 and 3),
  -- Markdown with LaTeX, with the program's values filled in; null until ready.
  statement text check (char_length(statement) between 1 and 20000),
  solution text check (char_length(solution) between 1 and 20000),
  -- The program's final values, in the Exercise shape: a list of
  -- { label, value, unit }. Null without numbers.
  final_answers jsonb check (
    final_answers is null or jsonb_typeof(final_answers) = 'array'
  ),
  -- The mathjs program the numbers come from; null without numbers.
  program text check (char_length(program) between 1 and 4000),
  -- Why a failed run failed.
  failure text check (char_length(failure) between 1 and 2000),
  -- The Student's flag on a ready Problem; set once.
  flag text check (flag in ('unclear', 'wrong', 'too_easy', 'off_topic')),
  flagged_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'ready' or (statement is not null and solution is not null)),
  check ((status = 'failed') = (failure is not null)),
  check ((flag is null) = (flagged_at is null)),
  check (flag is null or status = 'ready'),
  check (source = 'variant' or original_exercise_id is null)
);

comment on table public.problems is 'A generated Problem of a Course: a variant of an Exercise or a new Problem, with numbers from its program. Written by the generate workflow; the Student may flag a ready one.';

create table public.problem_kcs (
  problem_id uuid not null references public.problems (id) on delete cascade,
  kc_id uuid not null references public.kcs (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  primary key (problem_id, kc_id)
);

comment on table public.problem_kcs is 'A KC a generated Problem tests.';

create index problems_owner_idx on public.problems (owner);
create index problems_course_id_status_idx on public.problems (course_id, status);
create index problems_topic_id_idx on public.problems (topic_id);
create index problems_original_exercise_id_idx on public.problems (original_exercise_id);
create index problem_kcs_owner_idx on public.problem_kcs (owner);
create index problem_kcs_course_id_idx on public.problem_kcs (course_id);
create index problem_kcs_kc_id_idx on public.problem_kcs (kc_id);

-- The flag's time is the database's, so a flag cannot be backdated.
create function private.stamp_problem_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.flag is distinct from old.flag then
    new.flagged_at := case when new.flag is null then null else now() end;
  end if;
  return new;
end;
$$;

revoke execute on function private.stamp_problem_flag() from public, anon, authenticated;

create trigger problems_stamp_flag
before update of flag on public.problems
for each row execute function private.stamp_problem_flag();

alter table public.problems enable row level security;
alter table public.problem_kcs enable row level security;

create policy "Students can read their own problems"
on public.problems for select to authenticated
using ((select auth.uid()) = owner);

-- Once, on a ready Problem: a flagged one no longer matches `using`.
create policy "Students can flag their own ready problems once"
on public.problems for update to authenticated
using ((select auth.uid()) = owner and status = 'ready' and flag is null)
with check ((select auth.uid()) = owner and status = 'ready' and flag is not null);

create policy "Students can read their own problem KCs"
on public.problem_kcs for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.problems from anon, authenticated;
revoke all on table public.problem_kcs from anon, authenticated;
grant select on table public.problems to authenticated;
grant update (flag) on table public.problems to authenticated;
grant select on table public.problem_kcs to authenticated;

-- Questions on a Problem -----------------------------------------------------

-- The generated Problem a question poses; a question poses an Exercise or a
-- Problem, never both.
alter table public.questions
  add column problem_id uuid references public.problems (id) on delete set null,
  add constraint questions_one_problem check (exercise_id is null or problem_id is null);

create index questions_problem_id_idx on public.questions (problem_id);

-- As in 20261023100000, and a Problem must be a ready one of the session's
-- Course.
drop policy "Students can ask questions in their own sessions" on public.questions;

create policy "Students can ask questions in their own sessions"
on public.questions for insert to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.study_sessions
    where study_sessions.id = questions.session_id
      and study_sessions.owner = (select auth.uid())
      and (
        questions.exercise_id is null
        or exists (
          select 1 from public.exercises
          where exercises.id = questions.exercise_id
            and exercises.course_id = study_sessions.course_id
        )
      )
      and (
        questions.problem_id is null
        or exists (
          select 1 from public.problems
          where problems.id = questions.problem_id
            and problems.course_id = study_sessions.course_id
            and problems.status = 'ready'
        )
      )
  )
);

grant insert (problem_id) on table public.questions to authenticated;
