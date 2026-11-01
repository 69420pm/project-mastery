-- The build (#225): Course order of Materials, Part extractions, KC vectors
-- with match_kcs, retired KCs that keep their Attempts, and the build's
-- lease. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

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

-- A chunk, an extraction and two KCs -------------------------------------------

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000002',
  0, 1, 1, 'content', 'A vector space is a set.');
insert into public.part_extractions (part_id, owner, course_id, content_hash, output)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64),
  '{"kcs": [{"name": "Vector space", "embedding": [1]}], "prerequisites": []}');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.part_extractions), 1, 'the owner reads their Part extractions');
select throws_ok(
  $$update public.part_extractions set content_hash = repeat('b', 64)$$,
  '42501', null, 'a Student cannot write a Part extraction');
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.part_extractions), 0, 'another Student reads none');
reset role;

create function pg_temp.vec(axis int) returns text language sql as $$
  select '[' || array_to_string(array_agg(case when i = axis then 1 else 0 end order by i), ',') || ']'
  from generate_series(1, 2048) as i
$$;

-- The build runs, so it may store KCs.
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Vector spaces', 'Vector spaces', 0);
insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position, embedding)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    'Vector space', 'A set with addition.', 'concept', 'content', 0, pg_temp.vec(1)::extensions.vector),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    'Subspace', 'A closed subset.', 'concept', 'content', 1, pg_temp.vec(2)::extensions.vector);
insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
select id, 'cccccccc-0000-0000-0000-000000000001', owner, course_id from public.kcs;

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

-- Subspace loses its source and retires; its Big idea goes at the end of
-- the build.
delete from public.kc_sources where kc_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is(public.retire_unsourced_kcs('aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'a KC without sources retires');
select is(
  public.arrange_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001', '["Spaces"]',
    '[{"id": "bbbbbbbb-0000-0000-0000-000000000001", "bigIdea": "Spaces"}]'),
  true, 'the build ends in Course order');
select results_eq(
  $$select b.name, k.retired_at is null from public.kcs k left join public.big_ideas b on b.id = k.big_idea_id order by k.position$$,
  $$values ('Spaces'::text, true), (null, false)$$,
  'the live KC moves to the new Big idea, the retired one has none');
select is((select count(*)::int from public.attempts), 1, 'the retired KC keeps its Attempts');
select results_eq(
  $$select id from public.match_kcs('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(2), 5, true)$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000002'::uuid)$$,
  'match_kcs finds retired KCs only when asked');
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
