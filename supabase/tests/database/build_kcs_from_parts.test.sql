-- The build from Parts (#225): Course order of Materials, Part extractions,
-- KC vectors with match_kcs, retired KCs that keep their Attempts, and the
-- build's lease. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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

-- A Part with one chunk, its extraction and two KCs ------------------------------

insert into public.parts (id, owner, course_id, material_id, position, kind, title, chapter_title, page_from, page_to, content_hash)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000002', 0, 'teaching',
  'Vector spaces', 'Vector spaces', 1, 1, repeat('a', 64));
insert into public.chunks (id, owner, course_id, material_id, part_id, position, page_from, page_to, label, markdown)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000002',
  'eeeeeeee-0000-0000-0000-000000000001', 0, 1, 1, 'content', 'A vector space is a set.');
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

select is(
  public.store_part_kcs(
    'aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('id', 'bbbbbbbb-0000-0000-0000-000000000001', 'new', true,
        'name', 'Vector space', 'description', 'A set with addition.', 'type', 'concept',
        'bigIdea', 'Vector spaces', 'embedding', pg_temp.vec(1),
        'sources', jsonb_build_array('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000099')),
      jsonb_build_object('id', 'bbbbbbbb-0000-0000-0000-000000000002', 'new', true,
        'name', 'Subspace', 'description', 'A closed subset.', 'type', 'concept',
        'bigIdea', 'Vector spaces', 'embedding', pg_temp.vec(2),
        'sources', jsonb_build_array('cccccccc-0000-0000-0000-000000000001'))),
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000002"}]',
    '[{"partId": "eeeeeeee-0000-0000-0000-000000000001", "kcIds": ["bbbbbbbb-0000-0000-0000-000000000001"]}]'),
  true, 'the running build stores KCs');
select results_eq(
  $$select k.name, b.name, (select count(*)::int from public.kc_sources s where s.kc_id = k.id)
    from public.kcs k join public.big_ideas b on b.id = k.big_idea_id order by k.position$$,
  $$values ('Vector space', 'Vector spaces', 1), ('Subspace', 'Vector spaces', 1)$$,
  'new KCs land in their Big idea with the sources whose chunks exist');
select is((select count(*)::int from public.prerequisite_links), 1, 'with their Prerequisites');
select is(
  (select kc_ids::text || (output -> 'kcs' -> 0 ? 'embedding')::text from public.part_extractions),
  '{bbbbbbbb-0000-0000-0000-000000000001}false',
  'the extraction is marked stored and drops its vectors');

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

select throws_ok(
  $$select public.store_part_kcs('aaaaaaaa-0000-0000-0000-000000000099', '[]', '[]', '[]') from (select set_config('role', 'authenticated', true)) as s$$,
  '42501', null, 'a Student cannot store KCs');

select * from finish();
rollback;
