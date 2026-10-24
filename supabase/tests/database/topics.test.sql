-- Topics (#175): only the build workflow writes them through
-- replace_topics, which keeps stored ids and drops left-out Topics; a KC sits in at most one Topic; owners read their own. Run
-- with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, bloom, origin, position)
select ('cccccccc-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'KC ' || n, '.', 'concept', 'apply', 'content', n
from generate_series(1, 3) as n;

insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

-- The workflow stores two Topics.
set local role service_role;
select is(
  public.replace_topics('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"id": null, "bigIdea": "bbbbbbbb-0000-0000-0000-000000000001", "name": "Thrust",
        "centralQuestion": "Where does thrust come from?", "whyItMatters": ".",
        "kcs": ["cccccccc-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000001"]},
      {"id": null, "bigIdea": "bbbbbbbb-0000-0000-0000-000000000001", "name": "Drag",
        "centralQuestion": "What holds it back?", "whyItMatters": ".",
        "kcs": ["cccccccc-0000-0000-0000-000000000003"]}]'),
  true, 'a running build stores its Topics');
reset role;
select results_eq(
  $$select t.name, t.position, array_agg(k.name order by tk.position)
    from public.topics t join public.topic_kcs tk on tk.topic_id = t.id
    join public.kcs k on k.id = tk.kc_id
    where t.course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    group by t.id order by t.position$$,
  $$values ('Thrust', 0, '{KC 2,KC 1}'::text[]), ('Drag', 1, '{KC 3}'::text[])$$,
  'Topics are stored in order with their KCs in teaching order');
select is((select status from public.knowledge_map_builds
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'building', 'storing Topics leaves the build running');

update public.knowledge_map_builds set status = 'built'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select is(
  public.replace_topics('aaaaaaaa-0000-0000-0000-000000000001', '[]'),
  false, 'without a running build nothing is stored');
reset role;
select is((select count(*)::int from public.topics
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2, 'the Topics are unchanged');

-- An update keeps a named Topic's id, moves it last and drops the other.
create temporary table kept as select id from public.topics
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'Thrust';
grant select on kept to service_role;
update public.knowledge_map_builds set status = 'building'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select replace_topics('aaaaaaaa-0000-0000-0000-000000000001',
  jsonb_build_array(
    jsonb_build_object('id', null, 'bigIdea', 'bbbbbbbb-0000-0000-0000-000000000001',
      'name', 'New', 'centralQuestion', 'New?', 'whyItMatters', '.',
      'kcs', '["cccccccc-0000-0000-0000-000000000003"]'::jsonb),
    jsonb_build_object('id', (select id from kept), 'bigIdea', 'bbbbbbbb-0000-0000-0000-000000000001',
      'name', 'Thrust', 'centralQuestion', 'Where does thrust come from?', 'whyItMatters', '.',
      'kcs', '["cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002"]'::jsonb)));
reset role;
select results_eq(
  $$select name, position, id = (select id from kept) from public.topics
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by position$$,
  $$values ('New', 0, false), ('Thrust', 1, true)$$,
  'a named Topic keeps its id and a left-out one goes');

-- A KC sits in at most one Topic.
select throws_ok(
  $$insert into public.topic_kcs (topic_id, kc_id, owner, position)
    select id, 'cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 9
    from public.topics
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'New'$$,
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
  $$select public.replace_topics('aaaaaaaa-0000-0000-0000-000000000001', '[]')$$,
  '42501', null, 'a Student cannot call replace_topics');
reset role;

select * from finish();
rollback;
