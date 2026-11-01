-- The Topic tree (#229, slice 17 of #222). One Course-level call groups the
-- KCs into nested Topics built from the Materials' Outlines; Big ideas go.
-- A Topic may hold KCs of its own, from whole Chapters, and children. Exam
-- scopes sit on Topics only, inherited down the tree when read. Changes the
-- schema only: no rows exist (#222, Shipping).

-- Big ideas go ---------------------------------------------------------------------

drop function public.set_exam_scope(uuid, uuid, uuid, text, text);

alter table public.exam_scopes drop constraint exam_scopes_check;
alter table public.exam_scopes drop column big_idea_id;
alter table public.exam_scopes alter column topic_id set not null;

comment on table public.exam_scopes is 'A Student-confirmed statement that the exam excludes or emphasizes one Topic, and so its subtree unless a Topic below has its own.';

alter table public.kcs drop column big_idea_id;
alter table public.topics drop column big_idea_id;
alter table public.topics drop column part_hashes;
drop table public.big_ideas;

-- Nested Topics --------------------------------------------------------------------

-- A Topic holds KCs of its own when it has Chapters (`chapter_ids`), and
-- then a central question; one without has neither and holds only child
-- Topics. `position` is the Topic's place in tree order across the Course:
-- a parent before its children, siblings in order.
alter table public.topics
  add column parent_id uuid references public.topics (id) on delete cascade
    deferrable initially deferred,
  add column chapter_ids uuid[] not null default '{}',
  alter column central_question drop not null,
  add constraint topics_own_kcs_check
    check ((central_question is null) = (cardinality(chapter_ids) = 0));

create index topics_parent_id_idx on public.topics (parent_id);

comment on table public.topics is 'A Topic of the Course''s Topic tree: the KCs of whole Chapters taught together with the question they answer, and child Topics.';
comment on column public.topics.parent_id is 'The Topic it sits in; null at the top.';
comment on column public.topics.chapter_ids is 'The Chapters whose KCs it holds itself; empty for a Topic that only holds child Topics.';
comment on column public.topics.position is '0-based place in tree order across the Course: a parent before its children, siblings in order.';

-- What the last tree call was given, so a build whose KCs and Outlines are
-- unchanged makes no call.
alter table public.knowledge_map_builds
  add column topic_tree_hash text check (char_length(topic_tree_hash) = 64);

comment on column public.knowledge_map_builds.topic_tree_hash is 'The hash of what the stored Topic tree was built from; null before one.';

-- Exam scopes on Topics -----------------------------------------------------------

-- Sets the exam scope of one Topic of the caller's Course, or removes it
-- when `scope` is null, and bumps the Brief's `updated_at`. False, changing
-- nothing, when the caller has no Brief for the Course or the Topic is not
-- the Course's.
create function public.set_exam_scope(
  course_id uuid,
  topic_id uuid,
  scope text default null,
  words text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.briefs b
  set updated_at = now()
  where b.course_id = set_exam_scope.course_id
    and b.owner = (select auth.uid());
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.topics t
    where t.id = set_exam_scope.topic_id and t.course_id = set_exam_scope.course_id
  ) then
    return false;
  end if;

  delete from public.exam_scopes s
  where s.course_id = set_exam_scope.course_id
    and s.topic_id = set_exam_scope.topic_id;

  if scope is not null then
    insert into public.exam_scopes (owner, course_id, topic_id, scope, words)
    values (
      (select auth.uid()),
      set_exam_scope.course_id,
      set_exam_scope.topic_id,
      set_exam_scope.scope,
      set_exam_scope.words
    );
  end if;
  return true;
end;
$$;

comment on function public.set_exam_scope(uuid, uuid, text, text) is 'Sets or (scope null) removes the exam scope of a Topic of the caller''s Course; false when it is not theirs.';

revoke execute on function public.set_exam_scope(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_exam_scope(uuid, uuid, text, text) to authenticated;

-- Ending a build ------------------------------------------------------------------

drop function public.arrange_knowledge_map(uuid, jsonb, jsonb, jsonb);

-- Ends a build while it is `building`; false, writing nothing, otherwise.
-- p_kcs: KC ids in Course order; the Course's other KCs follow.
-- p_topics: the Topic tree in tree order, each { id, parent, name,
-- centralQuestion, chapterIds, kcs }: `id` the stored Topic it continues
-- (null or unknown inserts one), `parent` the 0-based index of its parent's
-- entry (null at the top), `kcs` its own KC ids in teaching order. A
-- continued Topic keeps its id, and so its notes, choices and sessions;
-- stored Topics left out go.
-- p_topic_tree_hash: what the tree was built from.
-- p_dropped_prerequisites: [{ from, to }] redundant Prerequisites to delete.
-- Exercises go in Course order: Materials by position, then their question
-- chunks by position. Stores the check report and marks the build built.
-- Runs as its caller: only the service role may call it.
create function public.arrange_knowledge_map(
  p_course_id uuid,
  p_kcs jsonb,
  p_topics jsonb,
  p_topic_tree_hash text,
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

  -- Topics ---------------------------------------------------------------------

  -- Row ids by 0-based place in the array.
  select coalesce(
    jsonb_object_agg((e.ord - 1)::text, coalesce(r.id, gen_random_uuid())),
    '{}'
  )
  into v_ids
  from jsonb_array_elements(p_topics) with ordinality as e (value, ord)
  left join public.topics as r
    on r.course_id = p_course_id and r.id::text = e.value ->> 'id';

  insert into public.topics (
    id, owner, course_id, parent_id, name, central_question, chapter_ids,
    position
  )
  select
    (v_ids ->> (e.ord - 1)::text)::uuid, v_owner, p_course_id,
    (v_ids ->> (e.value ->> 'parent'))::uuid,
    e.value ->> 'name', e.value ->> 'centralQuestion',
    array(
      select c::uuid from jsonb_array_elements_text(e.value -> 'chapterIds') as c
    ),
    e.ord - 1
  from jsonb_array_elements(p_topics) with ordinality as e (value, ord)
  on conflict (id) do update
  set parent_id = excluded.parent_id,
    name = excluded.name,
    central_question = excluded.central_question,
    chapter_ids = excluded.chapter_ids,
    position = excluded.position;

  -- After the update, so no kept Topic still sits in one that goes.
  delete from public.topics
  where course_id = p_course_id
    and id not in (select value::uuid from jsonb_each_text(v_ids));

  delete from public.topic_kcs as t
  using public.topics as o
  where t.topic_id = o.id and o.course_id = p_course_id;

  insert into public.topic_kcs (topic_id, kc_id, owner, position)
  select (v_ids ->> (e.ord - 1)::text)::uuid, k.id, v_owner, x.ord - 1
  from jsonb_array_elements(p_topics) with ordinality as e (value, ord)
  cross join jsonb_array_elements_text(e.value -> 'kcs') with ordinality as x (kc_id, ord)
  join public.kcs as k on k.id::text = x.kc_id and k.course_id = p_course_id
  on conflict do nothing;

  -- Prerequisites and Exercises --------------------------------------------

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
    heartbeat_at = now(), check_report = p_check_report,
    topic_tree_hash = p_topic_tree_hash
  where course_id = p_course_id;
  return true;
end;
$$;

comment on function public.arrange_knowledge_map(uuid, jsonb, jsonb, text, jsonb, jsonb) is
  'Ends a build: KCs, the Topic tree and Exercises in Course order, redundant Prerequisites dropped, the check report stored and the build built, in one transaction. Build workflow (service role) only.';

revoke execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.arrange_knowledge_map(uuid, jsonb, jsonb, text, jsonb, jsonb)
  to service_role;
