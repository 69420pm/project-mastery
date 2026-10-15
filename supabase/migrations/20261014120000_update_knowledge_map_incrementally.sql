-- A Knowledge map grows with its Course's Materials instead of being replaced
-- whole (#83). `knowledge_map_chunks` records the chunks an update has
-- processed, so the next one maps only new chunks, and
-- `apply_knowledge_map_update` replaces `replace_knowledge_map`: big ideas,
-- KCs, Exercises and Findings keep their row ids across updates.

-- A chunk a Knowledge map update has processed, whether or not it teaches a
-- KC. Deleting the chunk (its Material deleted or re-parsed) removes the row,
-- so a re-parsed Material's chunks are new again.
create table public.knowledge_map_chunks (
  chunk_id uuid primary key references public.chunks (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade
);

comment on table public.knowledge_map_chunks is 'A chunk that a Knowledge map update has processed. Written by apply_knowledge_map_update only.';

create index knowledge_map_chunks_owner_idx on public.knowledge_map_chunks (owner);
create index knowledge_map_chunks_course_id_idx on public.knowledge_map_chunks (course_id);

alter table public.knowledge_map_chunks enable row level security;

create policy "Students can read their own knowledge map chunks"
on public.knowledge_map_chunks for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.knowledge_map_chunks from anon, authenticated;
grant select on table public.knowledge_map_chunks to authenticated;

-- Existing maps: a Course whose last build is `built` has processed the
-- chunks that existed when that build started, so its first update does not
-- map them twice. A Course whose last build failed or is running keeps no
-- record of when its map's build started, so its first update maps every
-- chunk again and dedup merges what repeats.
insert into public.knowledge_map_chunks (chunk_id, owner, course_id)
select c.id, b.owner, c.course_id
from public.chunks as c
join public.knowledge_map_builds as b on b.course_id = c.course_id
where b.status = 'built'
  and c.created_at <= b.started_at;

drop function public.replace_knowledge_map(uuid, jsonb, jsonb);

-- The build workflow's write: in one transaction, while the Course's build is
-- `building`, it makes the stored map the given one, records the processed
-- chunks, stores the check report and marks the build `built`. Returns false,
-- writing nothing, when no build is running. A build that fails before this
-- call leaves the stored map and its chunks unprocessed.
--
-- p_map is the whole map in the `knowledgeMapSchema` shape (src/features/
-- knowledge-map/schemas.ts): { bigIdeas: [{ id, name, description }], kcs:
-- [{ id, name, description, type, bloom, bigIdea, origin, sources: [chunk
-- id] }], prerequisites: [{ from, to, extractionConfidence }],
-- semanticLinks: [{ from, to, coreType, label }], exercises: [{ id, name,
-- questionChunk, taskType, solutionStatus, solution, difficulty, kcs: [KC
-- id] }], findings: [{ id?, kind, text, sources: [chunk id] }] }.
--
-- A big idea, KC, Exercise or Finding whose id is the id of one of the
-- Course's stored rows is that row, kept as it is; any other id is local to
-- the update and gets a new row, positioned after the stored ones in array
-- order. Stored rows the map leaves out are deleted, which is how removals
-- and merges reach the table. Sources, links and Exercise KCs are the map's.
-- Sources and processed chunks whose chunk is gone or belongs to another
-- Course are skipped, and so are new Exercises whose question chunk is. Runs
-- as its caller: only the service role may call it.
create function public.apply_knowledge_map_update(
  p_course_id uuid,
  p_map jsonb,
  p_chunk_ids uuid[],
  p_check_report jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_big_ideas jsonb;
  v_kcs jsonb;
  v_exercises jsonb;
  v_findings jsonb;
  v_big_idea_offset integer;
  v_kc_offset integer;
  v_exercise_offset integer;
  v_finding_offset integer;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  -- Row ids by the map's ids: a stored row's id stays, any other is new.
  -- Findings without an id are new and keyed by their place in the array.
  select coalesce(jsonb_object_agg(e.value ->> 'id', coalesce(r.id, gen_random_uuid())), '{}')
  into v_big_ideas
  from jsonb_array_elements(p_map -> 'bigIdeas') as e (value)
  left join public.big_ideas as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';
  select coalesce(jsonb_object_agg(e.value ->> 'id', coalesce(r.id, gen_random_uuid())), '{}')
  into v_kcs
  from jsonb_array_elements(p_map -> 'kcs') as e (value)
  left join public.kcs as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';
  select coalesce(jsonb_object_agg(e.value ->> 'id', coalesce(r.id, gen_random_uuid())), '{}')
  into v_exercises
  from jsonb_array_elements(coalesce(p_map -> 'exercises', '[]')) as e (value)
  left join public.exercises as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';
  select coalesce(jsonb_object_agg(e.ord::text, coalesce(r.id, gen_random_uuid())), '{}')
  into v_findings
  from jsonb_array_elements(coalesce(p_map -> 'findings', '[]'))
    with ordinality as e (value, ord)
  left join public.findings as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';

  -- Stored rows the map leaves out go; their sources, links and Exercise KCs
  -- cascade. The rest of those are rewritten from the map below.
  delete from public.findings
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_findings));
  delete from public.exercises
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_exercises));
  delete from public.kcs
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_kcs));
  delete from public.big_ideas
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_big_ideas));
  delete from public.kc_sources where course_id = p_course_id;
  delete from public.prerequisite_links where course_id = p_course_id;
  delete from public.semantic_links where course_id = p_course_id;
  delete from public.exercise_kcs where course_id = p_course_id;
  delete from public.finding_sources where course_id = p_course_id;

  select coalesce(max(position) + 1, 0) into v_big_idea_offset
  from public.big_ideas where course_id = p_course_id;
  select coalesce(max(position) + 1, 0) into v_kc_offset
  from public.kcs where course_id = p_course_id;
  select coalesce(max(position) + 1, 0) into v_exercise_offset
  from public.exercises where course_id = p_course_id;
  select coalesce(max(position) + 1, 0) into v_finding_offset
  from public.findings where course_id = p_course_id;

  insert into public.big_ideas (id, owner, course_id, name, description, position)
  select
    n.id, v_owner, p_course_id, n.value ->> 'name', n.value ->> 'description',
    v_big_idea_offset + row_number() over (order by n.ord) - 1
  from (
    select (v_big_ideas ->> (e.value ->> 'id'))::uuid as id, e.value, e.ord
    from jsonb_array_elements(p_map -> 'bigIdeas') with ordinality as e (value, ord)
  ) as n
  where not exists (select 1 from public.big_ideas as r where r.id = n.id);

  insert into public.kcs (
    id, owner, course_id, big_idea_id, name, description, type, bloom, origin, position
  )
  select
    n.id, v_owner, p_course_id, (v_big_ideas ->> (n.value ->> 'bigIdea'))::uuid,
    n.value ->> 'name', n.value ->> 'description', n.value ->> 'type',
    n.value ->> 'bloom', n.value ->> 'origin',
    v_kc_offset + row_number() over (order by n.ord) - 1
  from (
    select (v_kcs ->> (e.value ->> 'id'))::uuid as id, e.value, e.ord
    from jsonb_array_elements(p_map -> 'kcs') with ordinality as e (value, ord)
  ) as n
  where not exists (select 1 from public.kcs as r where r.id = n.id);

  insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
  select distinct (v_kcs ->> (k.value ->> 'id'))::uuid, c.id, v_owner, p_course_id
  from jsonb_array_elements(p_map -> 'kcs') as k (value)
  cross join jsonb_array_elements_text(k.value -> 'sources') as s (chunk_id)
  join public.chunks as c
    on c.id = s.chunk_id::uuid and c.course_id = p_course_id;

  insert into public.prerequisite_links (owner, course_id, from_kc, to_kc, extraction_confidence)
  select
    v_owner, p_course_id, (v_kcs ->> (l.value ->> 'from'))::uuid,
    (v_kcs ->> (l.value ->> 'to'))::uuid,
    (l.value ->> 'extractionConfidence')::numeric
  from jsonb_array_elements(p_map -> 'prerequisites') as l (value)
  on conflict (from_kc, to_kc) do nothing;

  insert into public.semantic_links (owner, course_id, from_kc, to_kc, core_type, label)
  select
    v_owner, p_course_id, (v_kcs ->> (l.value ->> 'from'))::uuid,
    (v_kcs ->> (l.value ->> 'to'))::uuid, l.value ->> 'coreType', l.value ->> 'label'
  from jsonb_array_elements(p_map -> 'semanticLinks') as l (value);

  -- Positions count the stored exercises only, so a skipped one leaves no gap.
  insert into public.exercises (
    id, owner, course_id, question_chunk_id, name, task_type, solution_status,
    solution, difficulty, position
  )
  select
    n.id, v_owner, p_course_id, c.id,
    n.value ->> 'name', n.value ->> 'taskType', n.value ->> 'solutionStatus',
    n.value ->> 'solution', (n.value ->> 'difficulty')::smallint,
    v_exercise_offset + row_number() over (order by n.ord) - 1
  from (
    select (v_exercises ->> (e.value ->> 'id'))::uuid as id, e.value, e.ord
    from jsonb_array_elements(coalesce(p_map -> 'exercises', '[]'))
      with ordinality as e (value, ord)
  ) as n
  join public.chunks as c
    on c.id = (n.value ->> 'questionChunk')::uuid and c.course_id = p_course_id
  where not exists (select 1 from public.exercises as r where r.id = n.id);

  insert into public.exercise_kcs (exercise_id, kc_id, owner, course_id)
  select distinct x.id, (v_kcs ->> k.kc_id)::uuid, v_owner, p_course_id
  from jsonb_array_elements(coalesce(p_map -> 'exercises', '[]')) as e (value)
  cross join jsonb_array_elements_text(e.value -> 'kcs') as k (kc_id)
  join public.exercises as x on x.id = (v_exercises ->> (e.value ->> 'id'))::uuid
  where v_kcs ? k.kc_id;

  insert into public.findings (id, owner, course_id, kind, text, position)
  select
    n.id, v_owner, p_course_id, n.value ->> 'kind', n.value ->> 'text',
    v_finding_offset + row_number() over (order by n.ord) - 1
  from (
    select (v_findings ->> e.ord::text)::uuid as id, e.value, e.ord
    from jsonb_array_elements(coalesce(p_map -> 'findings', '[]'))
      with ordinality as e (value, ord)
  ) as n
  where not exists (select 1 from public.findings as r where r.id = n.id);

  insert into public.finding_sources (finding_id, chunk_id, owner, course_id)
  select distinct (v_findings ->> f.ord::text)::uuid, c.id, v_owner, p_course_id
  from jsonb_array_elements(coalesce(p_map -> 'findings', '[]'))
    with ordinality as f (value, ord)
  cross join jsonb_array_elements_text(f.value -> 'sources') as s (chunk_id)
  join public.chunks as c
    on c.id = s.chunk_id::uuid and c.course_id = p_course_id;

  insert into public.knowledge_map_chunks (chunk_id, owner, course_id)
  select c.id, v_owner, p_course_id
  from unnest(p_chunk_ids) as p (chunk_id)
  join public.chunks as c on c.id = p.chunk_id and c.course_id = p_course_id
  on conflict (chunk_id) do nothing;

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, check_report = p_check_report,
    finished_at = now()
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.apply_knowledge_map_update(uuid, jsonb, uuid[], jsonb) is
  'Makes a Course''s stored Knowledge map the given one, keeping the rows whose ids it names, records the processed chunks, stores its check report and marks the running build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.apply_knowledge_map_update(uuid, jsonb, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_knowledge_map_update(uuid, jsonb, uuid[], jsonb)
  to service_role;
