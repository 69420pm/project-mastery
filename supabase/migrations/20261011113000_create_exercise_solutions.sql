-- Exercises paired with their solutions across a Course (#59). The parse
-- workflow (service role) recomputes the pairs of a whole Course after every
-- finished parse and every Material deletion; a Student reads their own.

-- Each exercise subtask chunk has one row: paired with a solution chunk,
-- which may be in another Material of the Course, or `no_solution`. Deleting
-- either chunk removes the row; the next pairing pass writes it again.
create table public.exercise_solutions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  exercise_chunk_id uuid not null unique references public.chunks (id) on delete cascade,
  solution_chunk_id uuid references public.chunks (id) on delete cascade,
  status text not null check (status in ('paired', 'no_solution')),
  created_at timestamptz not null default now(),
  check ((status = 'paired') = (solution_chunk_id is not null))
);

comment on table public.exercise_solutions is 'An exercise subtask chunk with its solution chunk in the same Course, or no solution.';

create index exercise_solutions_owner_idx on public.exercise_solutions (owner);
create index exercise_solutions_course_id_idx on public.exercise_solutions (course_id);
create index exercise_solutions_solution_chunk_id_idx on public.exercise_solutions (solution_chunk_id);

alter table public.exercise_solutions enable row level security;

create policy "Students can read their own exercise solutions"
on public.exercise_solutions
for select
to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.exercise_solutions from anon, authenticated;
grant select on table public.exercise_solutions to authenticated;

-- The latest pairing request of a Course. Each pass takes a number when it
-- starts and writes only while its number is still the latest, so of passes
-- that overlap, only the last requested one writes. Students cannot update
-- it: they may update only a Course's name.
alter table public.courses
  add column pairing_requested bigint not null default 0;

comment on column public.courses.pairing_requested is 'The number of the latest exercise pairing pass requested for the Course. Written by request_exercise_pairing only.';

-- Starts a pairing pass of the Course: returns its number, or null when the
-- Course is gone. Runs as its caller: only the service role may call it.
create function public.request_exercise_pairing(p_course_id uuid)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  update public.courses
  set pairing_requested = pairing_requested + 1
  where id = p_course_id
  returning pairing_requested;
$$;

comment on function public.request_exercise_pairing(uuid) is
  'Takes the number of a new exercise pairing pass of a Course. Parse workflow (service role) only.';

-- A pairing pass's write: in one transaction, while p_request is still the
-- Course's latest request, it replaces all of the Course's pairs. Returns
-- false, writing nothing, when a later pass was requested meanwhile (it
-- writes instead) or the Course is gone. Waits on the Course row, so two
-- writes never interleave.
--
-- p_pairs is a jsonb array of { exercise_chunk_id, solution_chunk_id or
-- null }. Exercises deleted meanwhile are skipped, and an exercise whose
-- solution was deleted meanwhile is stored with no solution.
create function public.replace_exercise_solutions(
  p_course_id uuid,
  p_request bigint,
  p_pairs jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_latest bigint;
begin
  select owner, pairing_requested into v_owner, v_latest
  from public.courses
  where id = p_course_id
  for update;
  if not found or v_latest <> p_request then
    return false;
  end if;

  delete from public.exercise_solutions where course_id = p_course_id;

  insert into public.exercise_solutions (
    owner, course_id, exercise_chunk_id, solution_chunk_id, status
  )
  select
    v_owner, p_course_id, exercise.id, solution.id,
    case when solution.id is null then 'no_solution' else 'paired' end
  from jsonb_to_recordset(p_pairs) as p (
    exercise_chunk_id uuid, solution_chunk_id uuid
  )
  join public.chunks as exercise
    on exercise.id = p.exercise_chunk_id and exercise.course_id = p_course_id
  left join public.chunks as solution
    on solution.id = p.solution_chunk_id and solution.course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_exercise_solutions(uuid, bigint, jsonb) is
  'Replaces a Course''s exercise pairs while the pass is its latest request. Parse workflow (service role) only.';

revoke execute on function public.request_exercise_pairing(uuid)
  from public, anon, authenticated;
grant execute on function public.request_exercise_pairing(uuid)
  to service_role;
revoke execute on function public.replace_exercise_solutions(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_exercise_solutions(uuid, bigint, jsonb)
  to service_role;
