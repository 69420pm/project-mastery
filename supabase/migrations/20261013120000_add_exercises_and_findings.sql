-- Exercises and Findings of a Course's Knowledge map (#70). A build maps
-- each exercise subtask to the KCs it tests, checks or generates its
-- solution and records solution mismatches as findings. The Zod schemas in
-- src/features/knowledge-map/schemas.ts are the source of truth; these tables
-- mirror them. Only the build workflow (service role) writes them; a Student
-- reads their own rows.

-- A KC can come from an exercise that needs what the content does not teach.
alter table public.kcs drop constraint kcs_origin_check;
alter table public.kcs
  add constraint kcs_origin_check check (origin in ('content', 'prior', 'exercise'));

-- One analysed exercise subtask, whose question is a chunk labelled
-- `exercise`. Deleting the chunk removes it.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  question_chunk_id uuid not null references public.chunks (id) on delete cascade,
  -- As printed, such as "Ex. 7.2b".
  name text not null check (char_length(name) between 1 and 200),
  -- A short reusable label, such as "compute thrust".
  task_type text not null check (char_length(task_type) between 1 and 200),
  solution_status text not null check (
    solution_status in ('given', 'generated', 'verified', 'disputed')
  ),
  -- The build's own solution, stored only when none was given.
  solution text check (char_length(solution) between 1 and 20000),
  difficulty smallint not null check (difficulty between 1 and 3),
  -- 0-based reading order within the Course's map.
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (course_id, position),
  check ((solution_status = 'generated') = (solution is not null))
);

comment on table public.exercises is 'An exercise subtask of a Course, with the KCs it tests, its solution''s status and its difficulty.';

create table public.exercise_kcs (
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  kc_id uuid not null references public.kcs (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  primary key (exercise_id, kc_id)
);

comment on table public.exercise_kcs is 'A KC an Exercise tests.';

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  kind text not null check (kind in ('solution_mismatch')),
  text text not null check (char_length(text) between 1 and 2000),
  -- 0-based order within the Course's map.
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (course_id, position)
);

comment on table public.findings is 'Something a Knowledge map build found wrong in a Course''s material, such as a printed solution that does not match.';

create table public.finding_sources (
  finding_id uuid not null references public.findings (id) on delete cascade,
  chunk_id uuid not null references public.chunks (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  primary key (finding_id, chunk_id)
);

comment on table public.finding_sources is 'A chunk a Finding is about.';

create index exercises_owner_idx on public.exercises (owner);
create index exercises_course_id_idx on public.exercises (course_id);
create index exercises_question_chunk_id_idx on public.exercises (question_chunk_id);
create index exercise_kcs_owner_idx on public.exercise_kcs (owner);
create index exercise_kcs_course_id_idx on public.exercise_kcs (course_id);
create index exercise_kcs_kc_id_idx on public.exercise_kcs (kc_id);
create index findings_owner_idx on public.findings (owner);
create index findings_course_id_idx on public.findings (course_id);
create index finding_sources_owner_idx on public.finding_sources (owner);
create index finding_sources_course_id_idx on public.finding_sources (course_id);
create index finding_sources_chunk_id_idx on public.finding_sources (chunk_id);

alter table public.exercises enable row level security;
alter table public.exercise_kcs enable row level security;
alter table public.findings enable row level security;
alter table public.finding_sources enable row level security;

create policy "Students can read their own exercises"
on public.exercises for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own exercise KCs"
on public.exercise_kcs for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own findings"
on public.findings for select to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own finding sources"
on public.finding_sources for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.exercises from anon, authenticated;
revoke all on table public.exercise_kcs from anon, authenticated;
revoke all on table public.findings from anon, authenticated;
revoke all on table public.finding_sources from anon, authenticated;
grant select on table public.exercises to authenticated;
grant select on table public.exercise_kcs to authenticated;
grant select on table public.findings to authenticated;
grant select on table public.finding_sources to authenticated;

-- The build workflow's write, now with exercises and findings: in one
-- transaction, while the Course's build is `building`, it replaces the whole
-- map, its exercises and findings, stores the check report and marks the
-- build `built`. Returns false, writing nothing, when no build is running. A
-- build that fails before this call leaves the previous map.
--
-- p_map is the `knowledgeMapSchema` shape (src/features/knowledge-map/
-- schemas.ts): { bigIdeas: [{ id, name, description }], kcs: [{ id, name,
-- description, type, bloom, bigIdea, origin, sources: [chunk id] }],
-- prerequisites: [{ from, to, extractionConfidence }], semanticLinks:
-- [{ from, to, coreType, label }], exercises: [{ id, name, questionChunk,
-- taskType, solutionStatus, solution, difficulty, kcs: [KC id] }], findings:
-- [{ kind, text, sources: [chunk id] }] }. Its ids are local to the map;
-- stored rows get new ids. Array order is position. Sources whose chunk is
-- gone or belongs to another Course are skipped, and so are exercises whose
-- question chunk is. Runs as its caller: only the service role may call it.
create or replace function public.replace_knowledge_map(
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
  v_exercises jsonb;
  v_findings jsonb;
begin
  select owner into v_owner
  from public.knowledge_map_builds
  where course_id = p_course_id and status = 'building'
  for update;
  if not found then
    return false;
  end if;

  -- Sources, links and exercise KCs cascade.
  delete from public.findings where course_id = p_course_id;
  delete from public.exercises where course_id = p_course_id;
  delete from public.kcs where course_id = p_course_id;
  delete from public.big_ideas where course_id = p_course_id;

  -- New row ids by the map's local ids, or by position for findings.
  select coalesce(jsonb_object_agg(e.value ->> 'id', gen_random_uuid()), '{}')
  into v_big_ideas
  from jsonb_array_elements(p_map -> 'bigIdeas') as e (value);
  select coalesce(jsonb_object_agg(e.value ->> 'id', gen_random_uuid()), '{}')
  into v_kcs
  from jsonb_array_elements(p_map -> 'kcs') as e (value);
  select coalesce(jsonb_object_agg(e.value ->> 'id', gen_random_uuid()), '{}')
  into v_exercises
  from jsonb_array_elements(coalesce(p_map -> 'exercises', '[]')) as e (value);
  select coalesce(jsonb_object_agg(e.ord::text, gen_random_uuid()), '{}')
  into v_findings
  from jsonb_array_elements(coalesce(p_map -> 'findings', '[]'))
    with ordinality as e (value, ord);

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

  -- Positions count the stored exercises only, so a skipped one leaves no gap.
  insert into public.exercises (
    id, owner, course_id, question_chunk_id, name, task_type, solution_status,
    solution, difficulty, position
  )
  select
    (v_exercises ->> (e.value ->> 'id'))::uuid, v_owner, p_course_id, c.id,
    e.value ->> 'name', e.value ->> 'taskType', e.value ->> 'solutionStatus',
    e.value ->> 'solution', (e.value ->> 'difficulty')::smallint,
    row_number() over (order by e.ord) - 1
  from jsonb_array_elements(coalesce(p_map -> 'exercises', '[]'))
    with ordinality as e (value, ord)
  join public.chunks as c
    on c.id = (e.value ->> 'questionChunk')::uuid and c.course_id = p_course_id;

  insert into public.exercise_kcs (exercise_id, kc_id, owner, course_id)
  select distinct x.id, (v_kcs ->> k.kc_id)::uuid, v_owner, p_course_id
  from jsonb_array_elements(coalesce(p_map -> 'exercises', '[]')) as e (value)
  cross join jsonb_array_elements_text(e.value -> 'kcs') as k (kc_id)
  join public.exercises as x on x.id = (v_exercises ->> (e.value ->> 'id'))::uuid
  where v_kcs ? k.kc_id;

  insert into public.findings (id, owner, course_id, kind, text, position)
  select
    (v_findings ->> e.ord::text)::uuid, v_owner, p_course_id,
    e.value ->> 'kind', e.value ->> 'text', e.ord - 1
  from jsonb_array_elements(coalesce(p_map -> 'findings', '[]'))
    with ordinality as e (value, ord);

  insert into public.finding_sources (finding_id, chunk_id, owner, course_id)
  select distinct (v_findings ->> f.ord::text)::uuid, c.id, v_owner, p_course_id
  from jsonb_array_elements(coalesce(p_map -> 'findings', '[]'))
    with ordinality as f (value, ord)
  cross join jsonb_array_elements_text(f.value -> 'sources') as s (chunk_id)
  join public.chunks as c
    on c.id = s.chunk_id::uuid and c.course_id = p_course_id;

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, check_report = p_check_report,
    finished_at = now()
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_knowledge_map(uuid, jsonb, jsonb) is
  'Replaces a Course''s Knowledge map with its exercises and findings, stores its check report and marks the running build built, in one transaction. Build workflow (service role) only.';
