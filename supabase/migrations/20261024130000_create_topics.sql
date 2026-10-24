-- Topics (#175): every Knowledge map build ends with the Topics stage, which
-- groups each Big idea's KCs into Topics with a central question and stores
-- them with `replace_topics`, keeping their ids across updates. The build
-- now stays `building` after `apply_knowledge_map_update` and is marked
-- `built` by `replace_topics`. Only the build workflow (service role)
-- writes Topics; a Student reads their own.

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  big_idea_id uuid not null references public.big_ideas (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  central_question text not null check (char_length(central_question) between 1 and 500),
  why_it_matters text not null check (char_length(why_it_matters) between 1 and 1000),
  -- 0-based teaching order of the Course's Topics. Deferred, so
  -- `replace_topics` can reorder them in one statement.
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (course_id, position) deferrable initially deferred
);

comment on table public.topics is 'A Topic: KCs of one big idea taught together, with the question they answer.';

-- A KC sits in at most one Topic.
create table public.topic_kcs (
  topic_id uuid not null references public.topics (id) on delete cascade,
  kc_id uuid not null unique references public.kcs (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  -- 0-based teaching order within the Topic.
  position integer not null check (position >= 0),
  primary key (topic_id, kc_id)
);

comment on table public.topic_kcs is 'The KCs of a Topic, in teaching order.';

create index topics_owner_idx on public.topics (owner);
create index topics_course_id_idx on public.topics (course_id);
create index topics_big_idea_id_idx on public.topics (big_idea_id);
create index topic_kcs_owner_idx on public.topic_kcs (owner);

alter table public.topics enable row level security;
alter table public.topic_kcs enable row level security;

create policy "Students can read their own topics"
on public.topics for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own topic KCs"
on public.topic_kcs for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.topics from anon, authenticated;
revoke all on table public.topic_kcs from anon, authenticated;
grant select on table public.topics to authenticated;
grant select on table public.topic_kcs to authenticated;

-- Makes the Course's Topics the given ones, in order: each a JSON object
-- { id, bigIdea, name, centralQuestion, whyItMatters, kcs } with its KC ids
-- in teaching order. A stored Topic named by its id keeps it; a null or
-- unknown id inserts. Stored Topics left out go. Big ideas and KCs of
-- another Course are skipped. Marks the running build built; does nothing
-- when no build runs.
create function public.replace_topics(p_course_id uuid, p_topics jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_ids jsonb;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  -- Row ids by place in the array.
  select coalesce(jsonb_object_agg(e.ord::text, coalesce(r.id, gen_random_uuid())), '{}')
  into v_ids
  from jsonb_array_elements(p_topics) with ordinality as e (value, ord)
  left join public.topics as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';

  delete from public.topics
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_ids));
  delete from public.topic_kcs
  where topic_id in (select id from public.topics where course_id = p_course_id);

  insert into public.topics (
    id, owner, course_id, big_idea_id, name, central_question, why_it_matters, position
  )
  select
    (v_ids ->> e.ord::text)::uuid, v_owner, p_course_id, b.id,
    e.value ->> 'name', e.value ->> 'centralQuestion', e.value ->> 'whyItMatters',
    e.ord - 1
  from jsonb_array_elements(p_topics) with ordinality as e (value, ord)
  join public.big_ideas as b
    on b.id::text = e.value ->> 'bigIdea' and b.course_id = p_course_id
  on conflict (id) do update
  set big_idea_id = excluded.big_idea_id,
    name = excluded.name,
    central_question = excluded.central_question,
    why_it_matters = excluded.why_it_matters,
    position = excluded.position;

  insert into public.topic_kcs (topic_id, kc_id, owner, position)
  select t.id, k.id, v_owner, x.ord - 1
  from jsonb_array_elements(p_topics) with ordinality as e (value, ord)
  join public.topics as t on t.id = (v_ids ->> e.ord::text)::uuid
  cross join jsonb_array_elements_text(e.value -> 'kcs') with ordinality as x (kc_id, ord)
  join public.kcs as k on k.id::text = x.kc_id and k.course_id = p_course_id;

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, finished_at = now()
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_topics(uuid, jsonb) is
  'Makes a Course''s stored Topics the given ones, keeping the ids of stored Topics it names, and marks the running build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.replace_topics(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_topics(uuid, jsonb) to service_role;

-- `apply_knowledge_map_update` no longer marks the build built: the build
-- stays `building` until `replace_topics`. This definition is the one of
-- 20261024100000 with only the check report written at the end. The
-- signature is unchanged.
create or replace function public.apply_knowledge_map_update(
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
  -- cascade. The rest of those are rewritten from the map below. Big ideas go
  -- last, once no kept KC points to them.
  delete from public.findings
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_findings));
  delete from public.exercises
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_exercises));
  delete from public.kcs
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_kcs));
  delete from public.kc_sources where course_id = p_course_id;
  delete from public.prerequisite_links where course_id = p_course_id;
  delete from public.semantic_links where course_id = p_course_id;
  delete from public.exercise_kcs where course_id = p_course_id;
  delete from public.finding_sources where course_id = p_course_id;

  -- Offsets count the big ideas about to go, so new ones never take a
  -- position that is still in use.
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

  -- Kept KCs take their grouping and fields from the map; origin and
  -- position stay.
  update public.kcs as r
  set big_idea_id = (v_big_ideas ->> (e.value ->> 'bigIdea'))::uuid,
    name = e.value ->> 'name',
    description = e.value ->> 'description',
    type = e.value ->> 'type',
    bloom = e.value ->> 'bloom'
  from jsonb_array_elements(p_map -> 'kcs') as e (value)
  where r.course_id = p_course_id and r.id::text = e.value ->> 'id';

  delete from public.big_ideas
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_big_ideas));

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
  -- A JSON null `finalAnswers` is stored as SQL null.
  insert into public.exercises (
    id, owner, course_id, question_chunk_id, name, task_type, solution_status,
    solution, difficulty, final_answers, position
  )
  select
    n.id, v_owner, p_course_id, c.id,
    n.value ->> 'name', n.value ->> 'taskType', n.value ->> 'solutionStatus',
    n.value ->> 'solution', (n.value ->> 'difficulty')::smallint,
    nullif(n.value -> 'finalAnswers', 'null'::jsonb),
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
  set check_report = p_check_report
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.apply_knowledge_map_update(uuid, jsonb, uuid[], jsonb) is
  'Makes a Course''s stored Knowledge map the given one, keeping the rows whose ids it names (kept KCs take the map''s big idea and fields), records the processed chunks and stores its check report, in one transaction. The build stays building until replace_topics. Build workflow (service role) only.';
