-- Pairing v2 (#223, slice 8 of #222): code pairs by key within a Material
-- and between partner Materials, and the content call sees each leftover
-- exercise with its shortlist. A pair row remembers the shortlist of the
-- call that decided it, so an exercise whose shortlist is unchanged keeps
-- its result without a call.

alter table public.exercise_solutions
  add column candidates_hash text check (char_length(candidates_hash) = 64);

comment on column public.exercise_solutions.candidates_hash is 'SHA-256 of the sorted candidate chunk ids of the content call that decided the row; null when code decided it.';

-- p_pairs is a jsonb array of { exercise_chunk_id, solution_chunk_id or
-- null, candidates_hash or null }. Otherwise as before: while p_request is
-- still the Course's latest request, it replaces all of the Course's pairs
-- in one transaction, skipping exercises deleted meanwhile and storing an
-- exercise whose solution was deleted meanwhile with no solution.
create or replace function public.replace_exercise_solutions(
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
    owner, course_id, exercise_chunk_id, solution_chunk_id, status,
    candidates_hash
  )
  select
    v_owner, p_course_id, exercise.id, solution.id,
    case when solution.id is null then 'no_solution' else 'paired' end,
    p.candidates_hash
  from jsonb_to_recordset(p_pairs) as p (
    exercise_chunk_id uuid, solution_chunk_id uuid, candidates_hash text
  )
  join public.chunks as exercise
    on exercise.id = p.exercise_chunk_id and exercise.course_id = p_course_id
  left join public.chunks as solution
    on solution.id = p.solution_chunk_id and solution.course_id = p_course_id;

  return true;
end;
$$;
