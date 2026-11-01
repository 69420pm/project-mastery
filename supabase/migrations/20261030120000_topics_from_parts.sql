-- Prerequisites, Topics and Big ideas (#225, slice 11 of #222). What a KC
-- `assumes` becomes a Prerequisite through one bounded check per 25 names;
-- Topics come from Parts in code and keep their id while they hold Parts
-- with the same content hashes; one `topic` call per Big idea names the new
-- ones. The build ends with a check report. Changes the schema only: no map
-- rows exist (#222, Shipping).

-- Prerequisites from what KCs assume ---------------------------------------

alter table public.part_extractions
  add column assumes_matched boolean not null default false;

comment on column public.part_extractions.assumes_matched is 'Whether what its KCs assume was matched to earlier KCs as Prerequisites; false again when the Part is extracted again.';

-- Adds Prerequisites while the Course's build is `building` and marks the
-- given Parts' extractions matched; false, writing nothing, otherwise.
-- p_prerequisites: [{ from, to }] KC ids; links already stored are skipped.
create function public.store_assumed_prerequisites(
  p_course_id uuid,
  p_prerequisites jsonb,
  p_part_ids uuid[]
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

  update public.part_extractions
  set assumes_matched = true
  where course_id = p_course_id and part_id = any (p_part_ids);

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_assumed_prerequisites(uuid, jsonb, uuid[]) is
  'Stores the Prerequisites matched from what KCs assume and marks their Part extractions matched while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_assumed_prerequisites(uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.store_assumed_prerequisites(uuid, jsonb, uuid[])
  to service_role;

-- Topics from Parts -----------------------------------------------------------

-- A Topic keeps its id, name and central question while it holds Parts with
-- the same content hashes, so Topic choices, exam scopes and Topic notes
-- survive a re-parse that changes nothing.
alter table public.topics
  add column part_hashes text[] not null default '{}';

comment on column public.topics.part_hashes is 'The content_hash of each of its Parts, sorted; a half of a split Part is "<hash>/1" or "<hash>/2".';
comment on table public.topics is 'A Topic: the KCs of one or a few Parts of a chapter, taught together, with the question they answer.';

create index topics_part_hashes_idx on public.topics (course_id, part_hashes);

-- Stores newly named Topics while the Course's build is `building`, after
-- the Course's others, each in the Big idea named `bigIdea` (added at the
-- end when missing), without KCs until `arrange_knowledge_map`. A Topic
-- whose `partHashes` a stored Topic has is skipped. False, writing nothing,
-- when no build runs.
-- p_topics: [{ bigIdea, name, centralQuestion, partHashes }].
create function public.store_named_topics(p_course_id uuid, p_topics jsonb)
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

  insert into public.big_ideas (owner, course_id, name, description, position)
  select
    v_owner, p_course_id, n.name, n.name,
    coalesce(
      (select max(b.position) + 1 from public.big_ideas as b where b.course_id = p_course_id),
      0
    ) + (row_number() over (order by n.first)) - 1
  from (
    select t.value ->> 'bigIdea' as name, min(t.ord) as first
    from jsonb_array_elements(p_topics) with ordinality as t (value, ord)
    group by t.value ->> 'bigIdea'
  ) as n
  where not exists (
    select 1 from public.big_ideas as b
    where b.course_id = p_course_id and b.name = n.name
  );

  select coalesce(max(position) + 1, 0) into v_position
  from public.topics
  where course_id = p_course_id;

  insert into public.topics (
    owner, course_id, big_idea_id, name, central_question, position, part_hashes
  )
  select
    v_owner, p_course_id,
    (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = t.value ->> 'bigIdea'
    ),
    t.value ->> 'name', t.value ->> 'centralQuestion',
    v_position + (row_number() over (order by t.ord)) - 1,
    array(select jsonb_array_elements_text(t.value -> 'partHashes'))
  from jsonb_array_elements(p_topics) with ordinality as t (value, ord)
  where not exists (
    select 1 from public.topics as s
    where s.course_id = p_course_id
      and s.part_hashes = array(select jsonb_array_elements_text(t.value -> 'partHashes'))
  );

  update public.knowledge_map_builds
  set heartbeat_at = now()
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.store_named_topics(uuid, jsonb) is
  'Stores the Topics the build named, by their Parts'' content hashes, while the build runs. Build workflow (service role) only.';

revoke execute on function public.store_named_topics(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.store_named_topics(uuid, jsonb) to service_role;

-- Remaining duplicates ----------------------------------------------------------

-- Pairs of the Course's live KCs whose vectors are at least `p_similarity`
-- alike, most alike first, at most `p_count`: the duplicates the merge
-- calls left, for the check report. An exact scan, as `match_kcs`.
create function public.alike_kcs(
  p_course_id uuid,
  p_similarity double precision,
  p_count integer
)
returns table (a uuid, b uuid, similarity double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.id, y.id,
    (1 - (x.embedding operator(extensions.<=>) y.embedding))::double precision as similarity
  from public.kcs as x
  join public.kcs as y
    on y.course_id = x.course_id and y.id > x.id
  where x.course_id = p_course_id
    and x.retired_at is null and y.retired_at is null
    and x.embedding is not null and y.embedding is not null
    and 1 - (x.embedding operator(extensions.<=>) y.embedding) >= p_similarity
  order by similarity desc, x.id, y.id
  limit greatest(p_count, 0);
$$;

comment on function public.alike_kcs(uuid, double precision, integer) is
  'Pairs of a Course''s live KCs whose vectors are alike, for the check report. Build workflow (service role) only.';

revoke execute on function public.alike_kcs(uuid, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.alike_kcs(uuid, double precision, integer) to service_role;

-- Ending a build ------------------------------------------------------------------

comment on column public.knowledge_map_builds.check_report is 'What the last build checked: { kcsPerPart: [{ part, kcs, budget }], partsWithoutKcs, exercisesWithoutKcs, duplicates: [{ a, b, similarity }] }.';

drop function public.arrange_knowledge_map(uuid, jsonb, jsonb);

-- Ends a build while it is `building`; false, writing nothing, otherwise.
-- p_big_ideas: Big idea names in Course order. A stored Big idea keeps its
-- id while its name stays; the others go.
-- p_kcs: [{ id, bigIdea }] in Course order; the Course's other KCs follow.
-- p_topics: [{ id, bigIdea, kcs }] stored Topics in Course order, each with
-- its KC ids in teaching order; the Course's other Topics go.
-- p_dropped_prerequisites: [{ from, to }] redundant Prerequisites to delete.
-- Exercises go in Course order: Materials by position, then their question
-- chunks by position. Stores the check report and marks the build built.
create function public.arrange_knowledge_map(
  p_course_id uuid,
  p_big_ideas jsonb,
  p_kcs jsonb,
  p_topics jsonb default '[]',
  p_dropped_prerequisites jsonb default '[]',
  p_check_report jsonb default null
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

  -- Topics: positions are deferred-unique, so one update renumbers them.
  delete from public.topics
  where course_id = p_course_id
    and id not in (
      select (t.value ->> 'id')::uuid from jsonb_array_elements(p_topics) as t (value)
    );
  update public.topics as t
  set position = x.ord - 1,
    big_idea_id = (
      select b.id from public.big_ideas as b
      where b.course_id = p_course_id and b.name = x.value ->> 'bigIdea'
    )
  from jsonb_array_elements(p_topics) with ordinality as x (value, ord)
  where t.id = (x.value ->> 'id')::uuid and t.course_id = p_course_id;
  delete from public.topic_kcs as tk
  using public.topics as t
  where tk.topic_id = t.id and t.course_id = p_course_id;
  insert into public.topic_kcs (topic_id, kc_id, owner, position)
  select t.id, k.id, v_owner, i.ord - 1
  from jsonb_array_elements(p_topics) as x (value)
  join public.topics as t
    on t.id = (x.value ->> 'id')::uuid and t.course_id = p_course_id
  cross join jsonb_array_elements_text(x.value -> 'kcs') with ordinality as i (kc_id, ord)
  join public.kcs as k
    on k.id = i.kc_id::uuid and k.course_id = p_course_id and k.retired_at is null
  on conflict (kc_id) do nothing;

  delete from public.big_ideas
  where course_id = p_course_id and position >= v_offset;

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

comment on function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'Ends a build: Big ideas, KCs, Topics and Exercises in Course order, redundant Prerequisites dropped, the check report stored and the build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;
