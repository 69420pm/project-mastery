-- Extraction per Chapter (#229, slice 16 of #222). The build extracts KCs
-- from units of whole Chapters instead of Parts, with reasoning on and
-- without a KC budget or KC types, and stores KCs and Exercises without
-- Topics; the Topic tree follows in slice 17. Changes the schema only: no
-- rows exist (#222, Shipping).

-- Part extractions and the functions that wrote them go.
drop function public.store_assumed_prerequisites(uuid, jsonb, uuid[]);
drop function public.store_named_topics(uuid, jsonb);
drop function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb, jsonb, jsonb);
drop table public.part_extractions;

-- KCs lose their type, and need no Big idea while the build stores them
-- without Topics.
alter table public.kcs drop constraint kcs_big_idea_check;
alter table public.kcs drop column type;

-- Units ---------------------------------------------------------------------------

-- What the extraction call of a unit gave, checked in code, so a unit whose
-- content is unchanged is not called again. A unit is a Chapter's subtree,
-- or its own chunks outside its children, or a slice of either (`unit`);
-- `kind` says whether it holds `content` or `exercise` chunks.
create table public.chapter_extractions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  kind text not null check (kind in ('content', 'exercise')),
  -- 0-based, among the Chapter's units of that kind.
  unit integer not null check (unit >= 0),
  -- The unit's content_hash when it was extracted.
  content_hash text not null check (char_length(content_hash) = 64),
  -- { kcs: [{ name, description, chunkIds, assumes, embedding }],
  -- prerequisites: [{ from, to }] } with chunk ids and KC indexes; an
  -- exercise unit's also has { exercises: [{ chunkId, solutionChunkId,
  -- notAnExercise, kcIds, newKcs, finalAnswers, solutionLines }] }, whose
  -- newKcs index into kcs. The embeddings go once the KCs are stored.
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  -- The stored KC each extracted KC became, in output order; null until the
  -- build stored them.
  kc_ids uuid[],
  assumes_matched boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chapter_id, kind, unit)
);

comment on table public.chapter_extractions is 'The KCs and Prerequisites (and an exercise unit''s Exercises) the build extracted from a unit of a Chapter, kept while the unit''s content is unchanged.';
comment on column public.chapter_extractions.assumes_matched is 'Whether what its KCs assume was matched to earlier KCs as Prerequisites; false again when the unit is extracted again.';

create index chapter_extractions_owner_idx on public.chapter_extractions (owner);
create index chapter_extractions_course_id_idx on public.chapter_extractions (course_id);

alter table public.chapter_extractions enable row level security;

create policy "Students can read their own chapter extractions"
on public.chapter_extractions for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.chapter_extractions from anon, authenticated;
grant select on table public.chapter_extractions to authenticated;

-- Storing KCs ---------------------------------------------------------------------

-- Stores the KCs of consolidated unit extractions in one transaction, while
-- the Course's build is `building`; false, writing nothing, otherwise.
--
-- p_kcs: [{ id, new, name, description, origin, embedding, sources }]. A
-- `new` KC is inserted after the Course's KCs with its vector; any other is
-- a stored KC that gains `sources`, and a retired one comes back. Sources
-- whose chunk is gone are skipped.
-- p_prerequisites: [{ from, to }] KC ids; links already stored are skipped.
-- p_units: [{ extractionId, kcIds }]: the stored KC of each extracted KC,
-- which marks the extraction stored and drops its embeddings. An exercise
-- unit's entry also has `chunkIds`, its exercise chunks, and `exercises`:
-- [{ questionChunkId, solutionChunkId, kcIds, finalAnswers, difficulty }].
-- Its chunks first lose the KC sources of its earlier extraction; then each
-- Exercise is stored by its question chunk, keeping its id, the unit's
-- other Exercises go, and each listed Exercise tests exactly its `kcIds`.
-- New Exercises go after the Course's others; `arrange_knowledge_map` puts
-- them in Course order.
-- Runs as its caller: only the service role may call it.
create function public.store_chapter_kcs(
  p_course_id uuid,
  p_kcs jsonb,
  p_prerequisites jsonb,
  p_units jsonb
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
  using jsonb_array_elements(p_units) as u (value)
  cross join jsonb_array_elements_text(u.value -> 'chunkIds') as c (chunk_id)
  where u.value ? 'exercises'
    and s.course_id = p_course_id
    and s.chunk_id = c.chunk_id::uuid;

  select coalesce(max(position) + 1, 0) into v_position
  from public.kcs
  where course_id = p_course_id;

  insert into public.kcs (
    id, owner, course_id, name, description, origin, position, embedding
  )
  select
    (k.value ->> 'id')::uuid, v_owner, p_course_id,
    k.value ->> 'name', k.value ->> 'description',
    coalesce(k.value ->> 'origin', 'content'),
    v_position + (row_number() over (order by k.ord)) - 1,
    (k.value ->> 'embedding')::extensions.vector
  from jsonb_array_elements(p_kcs) with ordinality as k (value, ord)
  where (k.value ->> 'new')::boolean;

  update public.kcs as k
  set retired_at = null
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
  using jsonb_array_elements(p_units) as u (value)
  cross join jsonb_array_elements_text(u.value -> 'chunkIds') as c (chunk_id)
  where u.value ? 'exercises'
    and e.course_id = p_course_id
    and e.question_chunk_id = c.chunk_id::uuid
    and not exists (
      select 1 from jsonb_array_elements(u.value -> 'exercises') as x (value)
      where (x.value ->> 'questionChunkId')::uuid = e.question_chunk_id
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
    v_position + (row_number() over (order by u.ord, x.ord)) - 1
  from jsonb_array_elements(p_units) with ordinality as u (value, ord)
  cross join jsonb_array_elements(u.value -> 'exercises') with ordinality as x (value, ord)
  join public.chunks as q
    on q.id = (x.value ->> 'questionChunkId')::uuid and q.course_id = p_course_id
  left join public.chunks as s
    on s.id = (x.value ->> 'solutionChunkId')::uuid and s.course_id = p_course_id
  where u.value ? 'exercises'
  on conflict (question_chunk_id) do update
  set solution_chunk_id = excluded.solution_chunk_id,
    difficulty = excluded.difficulty,
    final_answers = excluded.final_answers;

  delete from public.exercise_kcs as ek
  using public.exercises as e,
    jsonb_array_elements(p_units) as u (value)
  cross join jsonb_array_elements(u.value -> 'exercises') as x (value)
  where u.value ? 'exercises'
    and e.course_id = p_course_id
    and e.question_chunk_id = (x.value ->> 'questionChunkId')::uuid
    and ek.exercise_id = e.id;

  insert into public.exercise_kcs (exercise_id, kc_id, owner, course_id)
  select distinct e.id, k.id, v_owner, p_course_id
  from jsonb_array_elements(p_units) as u (value)
  cross join jsonb_array_elements(u.value -> 'exercises') as x (value)
  cross join jsonb_array_elements_text(x.value -> 'kcIds') as i (kc_id)
  join public.exercises as e
    on e.question_chunk_id = (x.value ->> 'questionChunkId')::uuid
    and e.course_id = p_course_id
  join public.kcs as k
    on k.id = i.kc_id::uuid and k.course_id = p_course_id
  where u.value ? 'exercises';

  update public.chapter_extractions as e
  set
    kc_ids = array(
      select x.id::uuid
      from jsonb_array_elements_text(u.value -> 'kcIds') with ordinality as x (id, ord)
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
  from jsonb_array_elements(p_units) as u (value)
  where e.id = (u.value ->> 'extractionId')::uuid and e.course_id = p_course_id;

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_chapter_kcs(uuid, jsonb, jsonb, jsonb) is
  'Stores the KCs, sources, Prerequisites and Exercises of consolidated unit extractions while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_chapter_kcs(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_chapter_kcs(uuid, jsonb, jsonb, jsonb)
  to service_role;

-- Adds Prerequisites while the Course's build is `building` and marks the
-- given unit extractions matched; false, writing nothing, otherwise.
-- p_prerequisites: [{ from, to }] KC ids; links already stored are skipped.
create function public.store_assumed_prerequisites(
  p_course_id uuid,
  p_prerequisites jsonb,
  p_extraction_ids uuid[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
  select v_owner, p_course_id, f.id, t.id
  from jsonb_array_elements(p_prerequisites) as l (value)
  join public.kcs as f
    on f.id = (l.value ->> 'from')::uuid and f.course_id = p_course_id
  join public.kcs as t
    on t.id = (l.value ->> 'to')::uuid and t.course_id = p_course_id
  where f.id <> t.id
  on conflict (from_kc, to_kc) do nothing;

  update public.chapter_extractions
  set assumes_matched = true
  where course_id = p_course_id and id = any (p_extraction_ids);

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_assumed_prerequisites(uuid, jsonb, uuid[]) is
  'Stores the Prerequisites matched from what KCs assume and marks their unit extractions matched while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_assumed_prerequisites(uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.store_assumed_prerequisites(uuid, jsonb, uuid[])
  to service_role;

-- Ending a build ------------------------------------------------------------------

comment on column public.knowledge_map_builds.check_report is 'What the last build checked: { chaptersWithoutKcs, exercisesWithoutKcs, duplicates: [{ a, b, similarity }] }.';

-- Ends a build while it is `building`; false, writing nothing, otherwise.
-- p_kcs: KC ids in Course order; the Course's other KCs follow.
-- p_dropped_prerequisites: [{ from, to }] redundant Prerequisites to delete.
-- Exercises go in Course order: Materials by position, then their question
-- chunks by position. Stores the check report and marks the build built.
-- Runs as its caller: only the service role may call it.
create function public.arrange_knowledge_map(
  p_course_id uuid,
  p_kcs jsonb,
  p_dropped_prerequisites jsonb default '[]',
  p_check_report jsonb default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Above every position, so renumbering never meets a taken one.
  v_offset constant integer := 1000000;
begin
  perform 1
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  update public.kcs set position = position + v_offset
  where course_id = p_course_id;
  update public.kcs as k
  set position = x.ord - 1
  from jsonb_array_elements_text(p_kcs) with ordinality as x (id, ord)
  where k.id = x.id::uuid and k.course_id = p_course_id;
  update public.kcs as k
  set position = jsonb_array_length(p_kcs) + r.rank - 1
  from (
    select id, row_number() over (order by position) as rank
    from public.kcs
    where course_id = p_course_id and position >= v_offset
  ) as r
  where k.id = r.id;

  delete from public.prerequisite_links as l
  using jsonb_array_elements(p_dropped_prerequisites) as d (value)
  where l.course_id = p_course_id
    and l.from_kc = (d.value ->> 'from')::uuid
    and l.to_kc = (d.value ->> 'to')::uuid;

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
    heartbeat_at = now(), check_report = p_check_report
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb) is
  'Ends a build: KCs and Exercises in Course order, redundant Prerequisites dropped, the check report stored and the build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb)
  to service_role;
