-- Reading sections (#178): stage 2c of a Knowledge map build stores each
-- Topic's Reading sections per Course, with the mode a Student reads them in
-- (original, annotated or study text). Only the build workflow (service
-- role) writes them, through `replace_reading_sections`; a Student reads
-- their own. `replace_topics` no longer marks the build built:
-- `replace_reading_sections` does, in the same transaction as the sections.

create table public.reading_sections (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  -- 0-based within the Topic. Deferred, so the RPC can reorder in one statement.
  position integer not null check (position >= 0),
  page_from integer not null check (page_from >= 1),
  page_to integer not null check (page_to >= page_from),
  -- The chunks the section covers, in Material order.
  chunk_ids uuid[] not null check (cardinality(chunk_ids) > 0),
  mode text not null check (mode in ('original', 'annotated', 'study_text')),
  reason text not null check (char_length(reason) between 1 and 500),
  -- Null, or [{ "page": n, "note": "..." }].
  annotations jsonb check (annotations is null or jsonb_typeof(annotations) = 'array'),
  -- Null, or Markdown.
  study_text text,
  generated_at timestamptz not null default now(),
  unique (topic_id, position) deferrable initially deferred
);

comment on table public.reading_sections is 'A Reading section of a Topic: a few source pages of one Material, with the mode a Student reads them in.';

create index reading_sections_owner_idx on public.reading_sections (owner);
create index reading_sections_course_id_idx on public.reading_sections (course_id);
create index reading_sections_topic_id_idx on public.reading_sections (topic_id);
create index reading_sections_material_id_idx on public.reading_sections (material_id);

alter table public.reading_sections enable row level security;

create policy "Students can read their own reading sections"
on public.reading_sections for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.reading_sections from anon, authenticated;
grant select on table public.reading_sections to authenticated;

-- Makes the Course's Reading sections the given ones and marks the running
-- build built. Each is a JSON object { id, topic, material, position,
-- pageFrom, pageTo, chunkIds, mode, reason, annotations, studyText }. A
-- stored section named by its id keeps its row, mode and texts and takes
-- only the position and pages; a null or unknown id inserts. Stored sections
-- left out go. Topics and Materials of another Course are skipped. Does
-- nothing when no build runs.
create function public.replace_reading_sections(p_course_id uuid, p_sections jsonb)
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
  from jsonb_array_elements(p_sections) with ordinality as e (value, ord)
  left join public.reading_sections as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';

  delete from public.reading_sections
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_ids));

  insert into public.reading_sections (
    id, owner, course_id, topic_id, material_id, position, page_from, page_to,
    chunk_ids, mode, reason, annotations, study_text
  )
  select
    (v_ids ->> e.ord::text)::uuid, v_owner, p_course_id, t.id, m.id,
    (e.value ->> 'position')::integer, (e.value ->> 'pageFrom')::integer,
    (e.value ->> 'pageTo')::integer,
    array(select jsonb_array_elements_text(e.value -> 'chunkIds'))::uuid[],
    e.value ->> 'mode', e.value ->> 'reason',
    nullif(e.value -> 'annotations', 'null'::jsonb), e.value ->> 'studyText'
  from jsonb_array_elements(p_sections) with ordinality as e (value, ord)
  join public.topics as t
    on t.id::text = e.value ->> 'topic' and t.course_id = p_course_id
  join public.materials as m
    on m.id::text = e.value ->> 'material' and m.course_id = p_course_id
  on conflict (id) do update
  set position = excluded.position,
    page_from = excluded.page_from,
    page_to = excluded.page_to;

  update public.knowledge_map_builds
  set status = 'built', failure_reason = null, finished_at = now()
  where course_id = p_course_id;

  return true;
end;
$$;

comment on function public.replace_reading_sections(uuid, jsonb) is
  'Makes a Course''s stored Reading sections the given ones, keeping the rows of stored sections it names, and marks the running build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.replace_reading_sections(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_reading_sections(uuid, jsonb) to service_role;

-- `replace_topics` no longer marks the build built: it stays `building`
-- until `replace_reading_sections`. This definition is the one of
-- 20261024130000 without the final update. The signature is unchanged.
create or replace function public.replace_topics(p_course_id uuid, p_topics jsonb)
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

  return true;
end;
$$;

comment on function public.replace_topics(uuid, jsonb) is
  'Makes a Course''s stored Topics the given ones, keeping the ids of stored Topics it names, in one transaction. The build stays building until replace_reading_sections. Build workflow (service role) only.';
