-- Exercises (#225, slice 10 of #222): one `exercise` call per exercise Part
-- maps each subtask to the KCs it tests and copies its final answers as
-- printed. An Exercise keeps its printed solution's chunk and is stored by
-- its question chunk, so one whose pair changed is extracted again in place
-- with the same id, and its Attempts, Questions and Problems keep pointing
-- at it (#221). Changes the schema only: no map rows exist (#222, Shipping).

-- The paired solution chunk from `exercise_solutions` when it was extracted;
-- null when the Materials print none, and when that chunk is deleted.
alter table public.exercises
  add column solution_chunk_id uuid references public.chunks (id) on delete set null;

create index exercises_solution_chunk_id_idx on public.exercises (solution_chunk_id);

comment on column public.exercises.solution_chunk_id is 'The chunk of its printed solution; null when the Materials print none, so the AI solves it with the Student.';

-- One Exercise per exercise chunk.
drop index public.exercises_question_chunk_id_idx;
alter table public.exercises
  add constraint exercises_question_chunk_id_key unique (question_chunk_id);

comment on table public.exercises is 'An exercise subtask of a Course: its question chunk, the KCs it tests, its printed solution and final answers, and its difficulty.';

comment on column public.part_extractions.output is 'A teaching Part: { kcs, prerequisites }. An exercise Part: also { exercises: [{ chunkId, solutionChunkId, notAnExercise, kcIds, newKcs, finalAnswers, solutionLines }] }, whose newKcs index into kcs.';

-- As in 20261029180000, and also:
-- p_kcs: a `new` KC takes `origin` (`content` when missing).
-- p_parts: an exercise Part's entry has `exercises`: [{ questionChunkId,
-- solutionChunkId, kcIds, finalAnswers, difficulty }]. Its chunks first lose
-- the KC sources of its earlier extraction; then each Exercise is stored by
-- its question chunk, keeping its id, the Part's other Exercises go, and
-- each listed Exercise tests exactly its `kcIds`. New Exercises go after the
-- Course's others; `arrange_knowledge_map` puts them in Course order.
create or replace function public.store_part_kcs(
  p_course_id uuid,
  p_kcs jsonb,
  p_prerequisites jsonb,
  p_parts jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_position integer;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  delete from public.kc_sources as s
  using public.chunks as c, jsonb_array_elements(p_parts) as p (value)
  where p.value ? 'exercises'
    and c.part_id = (p.value ->> 'partId')::uuid
    and c.course_id = p_course_id
    and s.chunk_id = c.id;

  insert into public.big_ideas (owner, course_id, name, description, position)
  select
    v_owner, p_course_id, n.name, n.name,
    coalesce(
      (select max(b.position) + 1 from public.big_ideas as b where b.course_id = p_course_id),
      0
    ) + (row_number() over (order by n.first)) - 1
  from (
    select k.value ->> 'bigIdea' as name, min(k.ord) as first
    from jsonb_array_elements(p_kcs) with ordinality as k (value, ord)
    where k.value ->> 'bigIdea' is not null
    group by k.value ->> 'bigIdea'
  ) as n
  where not exists (
    select 1 from public.big_ideas as b
    where b.course_id = p_course_id and b.name = n.name
  );

  select coalesce(max(position) + 1, 0) into v_position
  from public.kcs
  where course_id = p_course_id;

  insert into public.kcs (
    id, owner, course_id, big_idea_id, name, description, type, origin,
    position, embedding
  )
  select
    (k.value ->> 'id')::uuid, v_owner, p_course_id,
    (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = k.value ->> 'bigIdea'
      order by b.position limit 1
    ),
    k.value ->> 'name', k.value ->> 'description', k.value ->> 'type',
    coalesce(k.value ->> 'origin', 'content'),
    v_position + (row_number() over (order by k.ord)) - 1,
    (k.value ->> 'embedding')::extensions.vector
  from jsonb_array_elements(p_kcs) with ordinality as k (value, ord)
  where (k.value ->> 'new')::boolean;

  update public.kcs as k
  set retired_at = null,
    big_idea_id = (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = r.value ->> 'bigIdea'
      order by b.position limit 1
    )
  from jsonb_array_elements(p_kcs) as r (value)
  where not (r.value ->> 'new')::boolean
    and k.id = (r.value ->> 'id')::uuid
    and k.course_id = p_course_id
    and k.retired_at is not null;

  insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
  select distinct kc.id, c.id, v_owner, p_course_id
  from jsonb_array_elements(p_kcs) as k (value)
  cross join jsonb_array_elements_text(k.value -> 'sources') as s (chunk_id)
  join public.kcs as kc
    on kc.id = (k.value ->> 'id')::uuid and kc.course_id = p_course_id
  join public.chunks as c
    on c.id = s.chunk_id::uuid and c.course_id = p_course_id
  on conflict (kc_id, chunk_id) do nothing;

  insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
  select v_owner, p_course_id, f.id, t.id
  from jsonb_array_elements(p_prerequisites) as l (value)
  join public.kcs as f
    on f.id = (l.value ->> 'from')::uuid and f.course_id = p_course_id
  join public.kcs as t
    on t.id = (l.value ->> 'to')::uuid and t.course_id = p_course_id
  where f.id <> t.id
  on conflict (from_kc, to_kc) do nothing;

  -- Exercises ------------------------------------------------------------------

  delete from public.exercises as e
  using public.chunks as c, jsonb_array_elements(p_parts) as p (value)
  where p.value ? 'exercises'
    and c.part_id = (p.value ->> 'partId')::uuid
    and c.course_id = p_course_id
    and e.question_chunk_id = c.id
    and not exists (
      select 1 from jsonb_array_elements(p.value -> 'exercises') as x (value)
      where (x.value ->> 'questionChunkId')::uuid = c.id
    );

  select coalesce(max(position) + 1, 0) into v_position
  from public.exercises
  where course_id = p_course_id;

  insert into public.exercises (
    owner, course_id, question_chunk_id, solution_chunk_id, difficulty,
    final_answers, position
  )
  select
    v_owner, p_course_id, q.id, s.id, (x.value ->> 'difficulty')::smallint,
    case
      when jsonb_array_length(coalesce(x.value -> 'finalAnswers', '[]')) > 0
        then x.value -> 'finalAnswers'
    end,
    v_position + (row_number() over (order by p.ord, x.ord)) - 1
  from jsonb_array_elements(p_parts) with ordinality as p (value, ord)
  cross join jsonb_array_elements(p.value -> 'exercises') with ordinality as x (value, ord)
  join public.chunks as q
    on q.id = (x.value ->> 'questionChunkId')::uuid and q.course_id = p_course_id
  left join public.chunks as s
    on s.id = (x.value ->> 'solutionChunkId')::uuid and s.course_id = p_course_id
  where p.value ? 'exercises'
  on conflict (question_chunk_id) do update
  set solution_chunk_id = excluded.solution_chunk_id,
    difficulty = excluded.difficulty,
    final_answers = excluded.final_answers;

  delete from public.exercise_kcs as ek
  using public.exercises as e, public.chunks as c, jsonb_array_elements(p_parts) as p (value)
  where p.value ? 'exercises'
    and c.part_id = (p.value ->> 'partId')::uuid
    and c.course_id = p_course_id
    and e.question_chunk_id = c.id
    and ek.exercise_id = e.id;

  insert into public.exercise_kcs (exercise_id, kc_id, owner, course_id)
  select distinct e.id, k.id, v_owner, p_course_id
  from jsonb_array_elements(p_parts) as p (value)
  cross join jsonb_array_elements(p.value -> 'exercises') as x (value)
  cross join jsonb_array_elements_text(x.value -> 'kcIds') as i (kc_id)
  join public.exercises as e
    on e.question_chunk_id = (x.value ->> 'questionChunkId')::uuid
    and e.course_id = p_course_id
  join public.kcs as k
    on k.id = i.kc_id::uuid and k.course_id = p_course_id
  where p.value ? 'exercises';

  update public.part_extractions as e
  set
    kc_ids = array(
      select x.id::uuid
      from jsonb_array_elements_text(p.value -> 'kcIds') with ordinality as x (id, ord)
      order by x.ord
    ),
    output = jsonb_set(
      e.output,
      '{kcs}',
      coalesce(
        (
          select jsonb_agg(x.value - 'embedding' order by x.ord)
          from jsonb_array_elements(e.output -> 'kcs') with ordinality as x (value, ord)
        ),
        '[]'::jsonb
      )
    )
  from jsonb_array_elements(p_parts) as p (value)
  where e.part_id = (p.value ->> 'partId')::uuid and e.course_id = p_course_id;

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_part_kcs(uuid, jsonb, jsonb, jsonb) is
  'Stores the KCs, sources, Prerequisites and Exercises of consolidated Part extractions while the build runs. Build workflow (service role) only.';

-- As in 20261029180000, and also puts the Exercises in Course order:
-- Materials by position, then their question chunks by position.
create or replace function public.arrange_knowledge_map(
  p_course_id uuid,
  p_big_ideas jsonb,
  p_kcs jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  -- Above every position, so renumbering never meets a taken one.
  v_offset constant integer := 1000000;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  update public.big_ideas set position = position + v_offset
  where course_id = p_course_id;
  insert into public.big_ideas (owner, course_id, name, description, position)
  select v_owner, p_course_id, n.name, n.name, v_offset * 2 + n.ord
  from jsonb_array_elements_text(p_big_ideas) with ordinality as n (name, ord)
  where not exists (
    select 1 from public.big_ideas as b
    where b.course_id = p_course_id and b.name = n.name
  );
  update public.big_ideas as b
  set position = n.ord - 1
  from jsonb_array_elements_text(p_big_ideas) with ordinality as n (name, ord)
  where b.course_id = p_course_id and b.name = n.name;

  update public.kcs set position = position + v_offset
  where course_id = p_course_id;
  update public.kcs as k
  set position = x.ord - 1,
    big_idea_id = (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = x.value ->> 'bigIdea'
    )
  from jsonb_array_elements(p_kcs) with ordinality as x (value, ord)
  where k.id = (x.value ->> 'id')::uuid and k.course_id = p_course_id;
  update public.kcs as k
  set position = jsonb_array_length(p_kcs) + r.rank - 1
  from (
    select id, row_number() over (order by position) as rank
    from public.kcs
    where course_id = p_course_id and position >= v_offset
  ) as r
  where k.id = r.id;

  delete from public.big_ideas
  where course_id = p_course_id and position >= v_offset;

  update public.exercises set position = position + v_offset
  where course_id = p_course_id;
  update public.exercises as e
  set position = r.rank - 1
  from (
    select x.id, row_number() over (order by m.position, c.position, x.id) as rank
    from public.exercises as x
    join public.chunks as c on c.id = x.question_chunk_id
    join public.materials as m on m.id = c.material_id
    where x.course_id = p_course_id
  ) as r
  where e.id = r.id;

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, finished_at = now(),
    heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;
