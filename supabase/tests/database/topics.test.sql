-- Topics (#175, #229): a KC sits in at most one Topic; Topics nest, and only
-- one with KCs of its own has Chapters and a central question; owners read
-- their own and write none. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.kcs (id, owner, course_id, name, description, origin, position)
select ('cccccccc-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'KC ' || n, '.', 'content', n
from generate_series(1, 3) as n;

-- Propulsion holds only Thrust and Drag; Thrust holds KCs of its own.
insert into public.topics (id, owner, course_id, parent_id, chapter_ids, name, central_question, position)
values
  ('dddddddd-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', null, '{}', 'Propulsion', null, 0),
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000000',
    '{bbbbbbbb-0000-0000-0000-000000000001}', 'Thrust', 'Where does thrust come from?', 1),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000000',
    '{bbbbbbbb-0000-0000-0000-000000000002}', 'Drag', 'What holds it back?', 2);

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

select throws_ok(
  $$insert into public.topics (owner, course_id, chapter_ids, name, central_question, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      '{}', 'Loose', 'Why?', 5)$$,
  '23514', null, 'a central question needs Chapters of its own');

-- Deleting a Topic deletes the Topics inside it.
savepoint nested;
delete from public.topics where id = 'dddddddd-0000-0000-0000-000000000000';
set constraints all immediate;
select is((select count(*)::int from public.topics), 0, 'a Topic goes with its parent');
rollback to savepoint nested;

-- Students read their own Topics and write none.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.topics) + (select count(*)::int from public.topic_kcs), 0,
  'another Student reads no Topics');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.topics) + (select count(*)::int from public.topic_kcs), 6,
  'the owner reads their Topics and their KCs');
select throws_ok(
  $$delete from public.topic_kcs$$,
  '42501', null, 'a Student cannot change Topic KCs');
select throws_ok(
  $$insert into public.topics (owner, course_id, chapter_ids, name, central_question, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      '{bbbbbbbb-0000-0000-0000-000000000001}', 'Mine', 'Why?', 5)$$,
  '42501', null, 'a Student cannot add a Topic');
reset role;

-- The build stores a new tree: Thrust continues at the top with Nozzles
-- inside it, Propulsion and Drag are not continued and go.
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

set local role service_role;
select ok(public.arrange_knowledge_map(
  'aaaaaaaa-0000-0000-0000-000000000001',
  '["cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"]',
  '[{"id": "dddddddd-0000-0000-0000-000000000001", "parent": null, "name": "Thrust", "centralQuestion": "Why thrust?", "chapterIds": ["bbbbbbbb-0000-0000-0000-000000000001"], "kcs": ["cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002"]},
    {"id": null, "parent": 0, "name": "Nozzles", "centralQuestion": "How do nozzles help?", "chapterIds": ["bbbbbbbb-0000-0000-0000-000000000003"], "kcs": ["cccccccc-0000-0000-0000-000000000003"]}]',
  repeat('a', 64)), 'arrange stores the Topic tree');
reset role;

select results_eq(
  $$select t.name, p.name, t.position,
      array(select k.name from public.topic_kcs x join public.kcs k on k.id = x.kc_id
        where x.topic_id = t.id order by x.position)
    from public.topics t left join public.topics p on p.id = t.parent_id
    order by t.position$$,
  $$values ('Thrust'::text, null::text, 0, array['KC 1', 'KC 2']::text[]),
    ('Nozzles', 'Thrust', 1, array['KC 3'])$$,
  'the new Topic sits inside the continued one, and the others go');
select is((select id from public.topics where name = 'Thrust'),
  'dddddddd-0000-0000-0000-000000000001'::uuid, 'the continued Topic keeps its id');

select * from finish();
rollback;
