-- The build (#225, #229): Course order of Materials, unit extractions of
-- Chapters, KCs stored without Topics with their sources and an exercise
-- unit's Exercises, KC vectors with match_kcs, retired KCs that keep their
-- Attempts, and the build's lease. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');

-- Course order -----------------------------------------------------------------

create function pg_temp.upload(p_id uuid, p_name text) returns void language sql as $$
  insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
  values (p_id, '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', p_name,
    'application/pdf', 1000, '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/' || p_id, 'parsed')
$$;

select pg_temp.upload('aaaaaaaa-1111-0000-0000-000000000010', 'Lecture 10');
select pg_temp.upload('aaaaaaaa-1111-0000-0000-000000000099', 'Formulas');
select pg_temp.upload('aaaaaaaa-1111-0000-0000-000000000002', 'Lecture 2');

select results_eq(
  $$select name from public.materials order by position$$,
  $$values ('Lecture 2'), ('Lecture 10'), ('Formulas')$$,
  'an upload is placed by the numbers in its name, unnumbered Materials last');

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.move_material('aaaaaaaa-1111-0000-0000-000000000099', 'up'), false,
  'another Student cannot move the Material');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.move_material('aaaaaaaa-1111-0000-0000-000000000099', 'up'), true,
  'the owner moves a Material up');
select is(public.move_material('aaaaaaaa-1111-0000-0000-000000000099', 'down'), true,
  'and down again');
select is(public.move_material('aaaaaaaa-1111-0000-0000-000000000099', 'down'), false,
  'the last Material moves no further down');
reset role;
select results_eq(
  $$select name from public.materials order by position$$,
  $$values ('Lecture 2'), ('Lecture 10'), ('Formulas')$$,
  'the moves swap neighbours');

-- An Outline, chunks and a unit extraction -------------------------------------

select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000002',
  '[{"position": 0, "parent_position": null, "depth": 0, "title": "Lecture 2", "page_from": 1},
    {"position": 1, "parent_position": 0, "depth": 1, "title": "Vector spaces", "page_from": 1}]',
  '[{"position": 0, "page_from": 1, "page_to": 1, "label": "content", "markdown": "A vector space is a set.", "chapter_position": 1},
    {"position": 1, "page_from": 2, "page_to": 2, "label": "exercise", "markdown": "Find dim U.", "chapter_position": 1},
    {"position": 2, "page_from": 2, "page_to": 2, "label": "exercise", "markdown": "Work in pairs.", "chapter_position": 1}]');

create function pg_temp.chunk(p_position int) returns uuid language sql as $$
  select id from public.chunks
  where material_id = 'aaaaaaaa-1111-0000-0000-000000000002' and position = p_position
$$;
create function pg_temp.chapter() returns uuid language sql as $$
  select id from public.chapters where title = 'Vector spaces'
$$;

insert into public.chapter_extractions (id, chapter_id, owner, course_id, kind, unit, content_hash, output)
values
  ('eeeeeeee-0000-0000-0000-000000000001', pg_temp.chapter(), '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'content', 0, repeat('a', 64),
    '{"kcs": [{"name": "Vector space", "embedding": [1]}], "prerequisites": []}'),
  ('eeeeeeee-0000-0000-0000-000000000002', pg_temp.chapter(), '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'exercise', 0, repeat('b', 64),
    '{"kcs": [], "prerequisites": [], "exercises": []}');

select throws_ok(
  $$insert into public.chapter_extractions (chapter_id, owner, course_id, kind, unit, content_hash, output)
    values (pg_temp.chapter(), '11111111-1111-1111-1111-111111111111',
      'aaaaaaaa-0000-0000-0000-000000000001', 'content', 0, repeat('c', 64), '{}')$$,
  '23505', null, 'a unit has one extraction');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.chapter_extractions), 2, 'the owner reads their unit extractions');
select throws_ok(
  $$update public.chapter_extractions set content_hash = repeat('c', 64)$$,
  '42501', null, 'a Student cannot write a unit extraction');
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.chapter_extractions), 0, 'another Student reads none');
reset role;

create function pg_temp.vec(axis int) returns text language sql as $$
  select '[' || array_to_string(array_agg(case when i = axis then 1 else 0 end order by i), ',') || ']'
  from generate_series(1, 2048) as i
$$;

-- Storing KCs -------------------------------------------------------------------

select is(
  public.store_chapter_kcs('aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('id', 'bbbbbbbb-0000-0000-0000-000000000001', 'new', true,
      'name', 'Vector space', 'description', 'A set with addition.', 'embedding', pg_temp.vec(1),
      'sources', jsonb_build_array(pg_temp.chunk(0)))),
    '[]',
    '[{"extractionId": "eeeeeeee-0000-0000-0000-000000000001", "kcIds": ["bbbbbbbb-0000-0000-0000-000000000001"]}]'),
  false, 'no KCs are stored while no build runs');

-- The build runs, so it may store KCs.
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

select is(
  public.store_chapter_kcs('aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('id', 'bbbbbbbb-0000-0000-0000-000000000001', 'new', true,
        'name', 'Vector space', 'description', 'A set with addition.', 'embedding', pg_temp.vec(1),
        'sources', jsonb_build_array(pg_temp.chunk(0))),
      jsonb_build_object('id', 'bbbbbbbb-0000-0000-0000-000000000002', 'new', true,
        'name', 'Subspace', 'description', 'A closed subset.', 'origin', 'exercise',
        'embedding', pg_temp.vec(2), 'sources', jsonb_build_array(pg_temp.chunk(1)))),
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000002"}]',
    jsonb_build_array(
      '{"extractionId": "eeeeeeee-0000-0000-0000-000000000001", "kcIds": ["bbbbbbbb-0000-0000-0000-000000000001"]}'::jsonb,
      jsonb_build_object('extractionId', 'eeeeeeee-0000-0000-0000-000000000002',
        'kcIds', '["bbbbbbbb-0000-0000-0000-000000000002"]'::jsonb,
        'chunkIds', jsonb_build_array(pg_temp.chunk(1), pg_temp.chunk(2)),
        'exercises', jsonb_build_array(jsonb_build_object('questionChunkId', pg_temp.chunk(1),
          'solutionChunkId', null, 'kcIds', '["bbbbbbbb-0000-0000-0000-000000000002"]'::jsonb,
          'finalAnswers', '[{"label": "dim U", "value": "2", "anyOrder": false}]'::jsonb, 'difficulty', 1))))),
  true, 'the running build stores KCs');
select results_eq(
  $$select name, origin from public.kcs order by position$$,
  $$values ('Vector space'::text, 'content'::text), ('Subspace', 'exercise')$$,
  'new KCs are stored with their origin');
select results_eq(
  $$select e.final_answers, k.name from public.exercises e
    join public.exercise_kcs x on x.exercise_id = e.id join public.kcs k on k.id = x.kc_id$$,
  $$values ('[{"label": "dim U", "value": "2", "anyOrder": false}]'::jsonb, 'Subspace'::text)$$,
  'the exercise unit stores its Exercise with its KCs');
select results_eq(
  $$select unit, kc_ids, output -> 'kcs' -> 0 ? 'embedding' from public.chapter_extractions where kind = 'content'$$,
  $$values (0, array['bbbbbbbb-0000-0000-0000-000000000001'::uuid], false)$$,
  'the extraction is marked stored and loses its embeddings');
select is((select count(*)::int from public.prerequisite_links), 1, 'the Prerequisite is stored');

select results_eq(
  $$select id, round(similarity::numeric, 3) from public.match_kcs('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(1), 5)$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 1.000), ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 0.000)$$,
  'match_kcs gives the nearest live KCs with their cosine similarity');

-- A Student meets Subspace in a question and an attempt.
insert into public.chats (id, owner, course_id)
values ('cccccccc-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.questions (id, session_id, kind, prompt)
select 'dddddddd-0000-0000-0000-000000000001', id, 'question', 'What is a subspace?'
from public.study_sessions;
insert into public.question_kcs (question_id, kc_id)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');
insert into public.attempts (question_id, session_id, kc_id, kind, result, help)
select 'dddddddd-0000-0000-0000-000000000001', id, 'bbbbbbbb-0000-0000-0000-000000000002', 'learn', 'full', 'none'
from public.study_sessions;

-- Subspace loses its source and retires.
delete from public.kc_sources where kc_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is(public.retire_unsourced_kcs('aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'a KC without sources retires');
select is((select count(*)::int from public.attempts), 1, 'the retired KC keeps its Attempts');
select results_eq(
  $$select id from public.match_kcs('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(2), 5, true)$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000002'::uuid)$$,
  'match_kcs finds retired KCs only when asked');
select is(
  public.arrange_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001',
    '["bbbbbbbb-0000-0000-0000-000000000001"]', '[]', repeat('a', 64)),
  true, 'the build ends');
select is((select status from public.knowledge_map_builds), 'built', 'the build is built');

-- The lease ----------------------------------------------------------------------

update public.knowledge_map_builds set status = 'building', heartbeat_at = now() - interval '31 minutes';
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_knowledge_map_build('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'a build silent for 30 minutes no longer holds a new one back');
reset role;

select * from finish();
rollback;
