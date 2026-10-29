-- The Knowledge map tables (#69): a Student starts one build at a time and
-- writes no map, a KC sits in a Big idea with one of the four KC types,
-- and owners read their own rows. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Chapter 7', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
    'parsing');

-- Queueing needs a parsed Material and none parsing, and the owner.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_knowledge_map_build('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'no build while a Material is parsing');
reset role;
update public.materials set parse_status = 'parsed' where id = 'aaaaaaaa-1111-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.queue_knowledge_map_build('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'another Student cannot build the Course''s map');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_knowledge_map_build('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'the owner starts a build');
select is(public.queue_knowledge_map_build('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'a second press while it runs starts nothing');
select is((select status from public.knowledge_map_builds), 'building', 'the build is running');

-- Students cannot write the map.
select throws_ok(
  $$insert into public.big_ideas (owner, course_id, name, description, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'x', 'y', 0)$$,
  '42501', null, 'a Student cannot insert a big idea');
reset role;

-- The workflow's map: one Big idea with two KCs and a Prerequisite.
insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);
insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    'Thrust', 'Net forward force.', 'fact', 'content', 0),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    'Thrust equation', 'F = ...', 'procedure', 'exercise', 1);
insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002');
update public.knowledge_map_builds set status = 'built', finished_at = now()
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select throws_ok(
  $$insert into public.kcs (owner, course_id, name, description, type, origin, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'Loose', '.', 'fact', 'content', 5)$$,
  '23502', null, 'a KC sits in a Big idea');
select throws_ok(
  $$insert into public.kcs (owner, course_id, big_idea_id, name, description, type, origin, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000001', 'Old', '.', 'prior', 'content', 5)$$,
  '23514', null, 'a KC has one of the four types');
select throws_ok(
  $$insert into public.kcs (owner, course_id, big_idea_id, name, description, type, origin, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000001', 'Old', '.', 'fact', 'prior', 5)$$,
  '23514', null, 'a KC comes from the content or an exercise');

-- Owners only.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.kcs) + (select count(*)::int from public.knowledge_map_builds)
    + (select count(*)::int from public.prerequisite_links),
  0, 'another Student reads none of the map');

-- A rebuild whose workflow does not start fails with a reason; the map stays.
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_knowledge_map_build('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'the owner starts a rebuild');
select is(public.record_knowledge_map_build_start_failure('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'a failed start is recorded');
select results_eq(
  $$select b.status, b.failure_reason is not null, (select count(*)::int from public.kcs)
    from public.knowledge_map_builds b$$,
  $$values ('failed', true, 2)$$,
  'the build failed and the owner still reads the previous map');
reset role;

select * from finish();
rollback;
