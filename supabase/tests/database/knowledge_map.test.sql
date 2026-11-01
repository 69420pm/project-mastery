-- The Knowledge map tables (#69): a Student starts one build at a time and
-- writes no map, a KC comes from the content or an exercise, and owners
-- read their own rows. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

-- A parse whose workflow died: no heartbeat for an hour.
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status, heartbeat_at)
values
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Stalled', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000002',
    'parsing', now() - interval '1 hour');

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
select is(
  (select parse_status || ': ' || parse_failure from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000002'),
  'failed: The parse stopped. Parse again.',
  'a parse without a heartbeat for 30 minutes does not hold the build back: it failed');

-- Students cannot write the map.
select throws_ok(
  $$insert into public.kcs (owner, course_id, name, description, origin, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'x', 'y', 'content', 0)$$,
  '42501', null, 'a Student cannot insert a KC');
reset role;

-- The workflow's map: two KCs and a Prerequisite.
insert into public.kcs (id, owner, course_id, name, description, origin, position)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Thrust', 'Net forward force.', 'content', 0),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Thrust equation', 'F = ...', 'exercise', 1);
insert into public.prerequisite_links (owner, course_id, from_kc, to_kc)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002');
update public.knowledge_map_builds set status = 'built', finished_at = now()
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into public.kcs (owner, course_id, name, description, origin, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'Loose', '.', 'content', 5)$$,
  'a live KC stands without a Topic (#229)');
select hasnt_column('public', 'kcs', 'type', 'a KC has no type (#229)');
select throws_ok(
  $$insert into public.kcs (owner, course_id, name, description, origin, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'Old', '.', 'prior', 6)$$,
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
  $$values ('failed', true, 3)$$,
  'the build failed and the owner still reads the previous map');
reset role;

select * from finish();
rollback;
