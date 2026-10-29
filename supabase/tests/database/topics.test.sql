-- Topics (#175): a KC sits in at most one Topic; owners read their own and
-- write none. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position)
select ('cccccccc-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'KC ' || n, '.', 'concept', 'content', n
from generate_series(1, 3) as n;

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, position)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    'Thrust', 'Where does thrust come from?', 0),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    'Drag', 'What holds it back?', 1);

insert into public.topic_kcs (topic_id, kc_id, owner, position)
values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111', 0),
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003',
    '11111111-1111-1111-1111-111111111111', 0);

-- A KC sits in at most one Topic.
select throws_ok(
  $$insert into public.topic_kcs (topic_id, kc_id, owner, position)
    values ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111', 9)$$,
  '23505', null, 'a second Topic for one KC is refused');

-- Students read their own Topics and write none.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.topics) + (select count(*)::int from public.topic_kcs), 0,
  'another Student reads no Topics');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.topics) + (select count(*)::int from public.topic_kcs), 5,
  'the owner reads their Topics and their KCs');
select throws_ok(
  $$delete from public.topic_kcs$$,
  '42501', null, 'a Student cannot change Topic KCs');
select throws_ok(
  $$insert into public.topics (owner, course_id, big_idea_id, name, central_question, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000001', 'Mine', 'Why?', 5)$$,
  '42501', null, 'a Student cannot add a Topic');
reset role;

select * from finish();
rollback;
