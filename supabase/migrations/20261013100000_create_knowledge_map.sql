-- The Knowledge map of a Course (#69): big ideas, knowledge components (KCs),
-- their sources, prerequisite and semantic links, and the state of the
-- Course's last build. The Zod schemas in
-- src/features/knowledge-map/schemas.ts are the source of truth; these tables
-- mirror them. Only the build workflow (service role) writes the map; a
-- Student reads their own rows.

create table public.big_ideas (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text not null check (char_length(description) between 1 and 1000),
  -- 0-based order within the Course's map.
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (course_id, position)
);

comment on table public.big_ideas is 'A big idea of a Course''s Knowledge map, which groups its KCs.';

create table public.kcs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  -- Null for prior knowledge, which belongs to no big idea.
  big_idea_id uuid references public.big_ideas (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text not null check (char_length(description) between 1 and 1000),
  type text not null check (type in ('fact', 'concept', 'procedure', 'decision', 'prior')),
  -- Null for prior knowledge.
  bloom text check (
    bloom in ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')
  ),
  origin text not null check (origin in ('content', 'prior')),
  -- 0-based order within the Course's map.
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (course_id, position),
  check ((type = 'prior') = (bloom is null)),
  check ((type = 'prior') = (big_idea_id is null)),
  check ((type = 'prior') = (origin = 'prior'))
);

comment on table public.kcs is 'A knowledge component of a Course''s Knowledge map: one thing a Student can learn, or prior knowledge the material assumes.';

-- The chunks that teach a KC. Deleting the KC or the chunk removes the row.
create table public.kc_sources (
  kc_id uuid not null references public.kcs (id) on delete cascade,
  chunk_id uuid not null references public.chunks (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  primary key (kc_id, chunk_id)
);

comment on table public.kc_sources is 'A chunk that teaches a KC.';

-- from_kc must be learned before to_kc. The workflow stores no cycles.
create table public.prerequisite_links (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  from_kc uuid not null references public.kcs (id) on delete cascade,
  to_kc uuid not null references public.kcs (id) on delete cascade,
  -- How sure the build is of the link, not the Student's mastery.
  extraction_confidence numeric not null check (extraction_confidence between 0 and 1),
  unique (from_kc, to_kc),
  check (from_kc <> to_kc)
);

comment on table public.prerequisite_links is 'A KC that must be learned before another.';

create table public.semantic_links (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  from_kc uuid not null references public.kcs (id) on delete cascade,
  to_kc uuid not null references public.kcs (id) on delete cascade,
  core_type text not null check (
    core_type in ('is_a', 'part_of', 'contrasts_with', 'causes', 'special_case_of', 'applies_in', 'other')
  ),
  -- Free text, such as "occurs in".
  label text not null check (char_length(label) between 1 and 200),
  check (from_kc <> to_kc)
);

comment on table public.semantic_links is 'A named relation between two KCs that orders no learning.';

-- One row per Course whose map was ever built. No row: never built.
create table public.knowledge_map_builds (
  course_id uuid primary key references public.courses (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('building', 'built', 'failed')),
  -- A short message for the Student when the build failed.
  failure_reason text check (char_length(failure_reason) between 1 and 300),
  -- The checks of the last built map (chunk coverage, KC grounding, orphans,
  -- dropped cycle edges); null before the first one.
  check_report jsonb check (check_report is null or jsonb_typeof(check_report) = 'object'),
  started_at timestamptz not null default now(),
  -- When the current map was built; kept while a rebuild runs or fails.
  finished_at timestamptz,
  check ((status = 'failed') = (failure_reason is not null))
);

comment on table public.knowledge_map_builds is 'The state of a Course''s last Knowledge map build. Written by queue_knowledge_map_build, record_knowledge_map_build_start_failure and the build workflow only.';

create index big_ideas_owner_idx on public.big_ideas (owner);
create index big_ideas_course_id_idx on public.big_ideas (course_id);
create index kcs_owner_idx on public.kcs (owner);
create index kcs_course_id_idx on public.kcs (course_id);
create index kcs_big_idea_id_idx on public.kcs (big_idea_id);
create index kc_sources_owner_idx on public.kc_sources (owner);
create index kc_sources_course_id_idx on public.kc_sources (course_id);
create index kc_sources_chunk_id_idx on public.kc_sources (chunk_id);
create index prerequisite_links_owner_idx on public.prerequisite_links (owner);
create index prerequisite_links_course_id_idx on public.prerequisite_links (course_id);
create index prerequisite_links_to_kc_idx on public.prerequisite_links (to_kc);
create index semantic_links_owner_idx on public.semantic_links (owner);
create index semantic_links_course_id_idx on public.semantic_links (course_id);
create index semantic_links_from_kc_idx on public.semantic_links (from_kc);
create index semantic_links_to_kc_idx on public.semantic_links (to_kc);
create index knowledge_map_builds_owner_idx on public.knowledge_map_builds (owner);

-- Row Level Security: owners read their own rows; writes come only from the
-- functions below and the workflow's service role.
alter table public.big_ideas enable row level security;
alter table public.kcs enable row level security;
alter table public.kc_sources enable row level security;
alter table public.prerequisite_links enable row level security;
alter table public.semantic_links enable row level security;
alter table public.knowledge_map_builds enable row level security;

create policy "Students can read their own big ideas"
on public.big_ideas for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own KCs"
on public.kcs for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own KC sources"
on public.kc_sources for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own prerequisite links"
on public.prerequisite_links for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own semantic links"
on public.semantic_links for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own knowledge map builds"
on public.knowledge_map_builds for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.big_ideas from anon, authenticated;
revoke all on table public.kcs from anon, authenticated;
revoke all on table public.kc_sources from anon, authenticated;
revoke all on table public.prerequisite_links from anon, authenticated;
revoke all on table public.semantic_links from anon, authenticated;
revoke all on table public.knowledge_map_builds from anon, authenticated;
grant select on table public.big_ideas to authenticated;
grant select on table public.kcs to authenticated;
grant select on table public.kc_sources to authenticated;
grant select on table public.prerequisite_links to authenticated;
grant select on table public.semantic_links to authenticated;
grant select on table public.knowledge_map_builds to authenticated;

-- Moves the signed-in Student's Course to `building` and says whether it
-- did: when no build is running, at least one Material is parsed and none is
-- queued or parsing. The conditional upsert lets only one of two concurrent
-- calls (a double click, two tabs) through, so the caller starts one
-- workflow.
create function public.queue_knowledge_map_build(course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with course as (
    select c.id, c.owner
    from public.courses as c
    where c.id = queue_knowledge_map_build.course_id
      and c.owner = (select auth.uid())
      and exists (
        select 1 from public.materials as m
        where m.course_id = c.id and m.parse_status = 'parsed'
      )
      and not exists (
        select 1 from public.materials as m
        where m.course_id = c.id and m.parse_status in ('queued', 'parsing')
      )
  ),
  queued as (
    insert into public.knowledge_map_builds as b (course_id, owner, status)
    select id, owner, 'building' from course
    on conflict (course_id) do update
    set status = 'building', failure_reason = null, started_at = now()
    where b.status <> 'building'
    returning b.course_id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_knowledge_map_build(uuid) is 'Starts a Knowledge map build of the caller''s Course if none is running, a Material is parsed and none is queued or parsing; true when it did.';

-- Fails the signed-in Student's running build after the server's `start()`
-- of its workflow failed; true when it did.
create function public.record_knowledge_map_build_start_failure(course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with failed as (
    update public.knowledge_map_builds
    set status = 'failed', failure_reason = 'The build could not start. Try again.'
    where course_id = record_knowledge_map_build_start_failure.course_id
      and owner = (select auth.uid())
      and status = 'building'
    returning course_id
  )
  select exists (select 1 from failed);
$$;

comment on function public.record_knowledge_map_build_start_failure(uuid) is 'Fails the caller''s running Knowledge map build whose workflow could not start; true when it did.';

revoke execute on function public.queue_knowledge_map_build(uuid) from public, anon;
grant execute on function public.queue_knowledge_map_build(uuid) to authenticated;
revoke execute on function public.record_knowledge_map_build_start_failure(uuid) from public, anon;
grant execute on function public.record_knowledge_map_build_start_failure(uuid) to authenticated;

-- The build workflow's write: in one transaction, while the Course's build is
-- `building`, it replaces the whole map, stores the check report and marks
-- the build `built`. Returns false, writing nothing, when no build is
-- running. A build that fails before this call leaves the previous map.
--
-- p_map is the `knowledgeMapSchema` shape (src/features/knowledge-map/
-- schemas.ts): { bigIdeas: [{ id, name, description }], kcs: [{ id, name,
-- description, type, bloom, bigIdea, origin, sources: [chunk id] }],
-- prerequisites: [{ from, to, extractionConfidence }], semanticLinks:
-- [{ from, to, coreType, label }] }. Its ids are local to the map; stored
-- rows get new ids. Array order is position. Sources whose chunk is gone or
-- belongs to another Course are skipped. Runs as its caller: only the service
-- role may call it.
create function public.replace_knowledge_map(
  p_course_id uuid,
  p_map jsonb,
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
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  -- Sources and links cascade.
  delete from public.kcs where course_id = p_course_id;
  delete from public.big_ideas where course_id = p_course_id;

  -- New row ids by the map's local ids.
  select coalesce(jsonb_object_agg(e.value ->> 'id', gen_random_uuid()), '{}')
  into v_big_ideas
  from jsonb_array_elements(p_map -> 'bigIdeas') as e (value);
  select coalesce(jsonb_object_agg(e.value ->> 'id', gen_random_uuid()), '{}')
  into v_kcs
  from jsonb_array_elements(p_map -> 'kcs') as e (value);

  insert into public.big_ideas (id, owner, course_id, name, description, position)
  select
    (v_big_ideas ->> (e.value ->> 'id'))::uuid, v_owner, p_course_id,
    e.value ->> 'name', e.value ->> 'description', e.ord - 1
  from jsonb_array_elements(p_map -> 'bigIdeas') with ordinality as e (value, ord);

  insert into public.kcs (
    id, owner, course_id, big_idea_id, name, description, type, bloom, origin, position
  )
  select
    (v_kcs ->> (e.value ->> 'id'))::uuid, v_owner, p_course_id,
    (v_big_ideas ->> (e.value ->> 'bigIdea'))::uuid,
    e.value ->> 'name', e.value ->> 'description', e.value ->> 'type',
    e.value ->> 'bloom', e.value ->> 'origin', e.ord - 1
  from jsonb_array_elements(p_map -> 'kcs') with ordinality as e (value, ord);

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

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, check_report = p_check_report,
    finished_at = now()
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_knowledge_map(uuid, jsonb, jsonb) is
  'Replaces a Course''s Knowledge map, stores its check report and marks the running build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.replace_knowledge_map(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_knowledge_map(uuid, jsonb, jsonb)
  to service_role;
