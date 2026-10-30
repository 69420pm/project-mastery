-- The end of a build from Parts (#225): Prerequisites from what KCs assume,
-- named Topics kept by their Parts' hashes, remaining duplicates and the
-- arranged map with its check report. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');
insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');
insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Vector spaces', 'Vector spaces', 0);

create function pg_temp.vec(axis int) returns extensions.vector language sql as $$
  select ('[' || array_to_string(array_agg(case when i = axis then 1 else 0 end order by i), ',') || ']')::extensions.vector
  from generate_series(1, 2048) as i
$$;

insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position, embedding)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    'Vector', 'An element.', 'concept', 'content', 0, pg_temp.vec(1)),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    'Vectors', 'Elements.', 'concept', 'content', 1, pg_temp.vec(1)),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
    'Basis', 'A spanning independent family.', 'concept', 'content', 2, pg_temp.vec(3));

select results_eq(
  $$select a, b from public.alike_kcs('aaaaaaaa-0000-0000-0000-000000000001', 0.85, 10)$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid)$$,
  'alike_kcs lists each pair of alike live KCs once');

select is(
  public.store_assumed_prerequisites('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000003"},
      {"from": "bbbbbbbb-0000-0000-0000-000000000002", "to": "bbbbbbbb-0000-0000-0000-000000000003"},
      {"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000002"}]',
    '{}'),
  true, 'the running build stores assumed Prerequisites');
select is((select count(*)::int from public.prerequisite_links), 3, 'all three are stored');

create function pg_temp.name(p_hashes text, p_name text) returns boolean language sql as $$
  select public.store_named_topics('aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('bigIdea', 'Bases', 'name', p_name,
      'centralQuestion', 'What is a basis?', 'partHashes', p_hashes::jsonb)))
$$;

select is(pg_temp.name('["a", "b"]', 'Bases'), true, 'the running build stores a named Topic');
select pg_temp.name('["a", "b"]', 'Bases again');
select pg_temp.name('["c"]', 'Leftover');
select results_eq(
  $$select t.name, b.name from public.topics t join public.big_ideas b on b.id = t.big_idea_id order by t.position$$,
  $$values ('Bases'::text, 'Bases'::text), ('Leftover', 'Bases')$$,
  'a Topic with the same Parts keeps its name; a new Big idea is added');

select is(
  public.arrange_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001', '["Bases"]',
    '[{"id": "bbbbbbbb-0000-0000-0000-000000000003", "bigIdea": "Bases"},
      {"id": "bbbbbbbb-0000-0000-0000-000000000001", "bigIdea": "Bases"},
      {"id": "bbbbbbbb-0000-0000-0000-000000000002", "bigIdea": "Bases"}]',
    jsonb_build_array(jsonb_build_object('id', (select id from public.topics where name = 'Bases'),
      'bigIdea', 'Bases', 'kcs', '["bbbbbbbb-0000-0000-0000-000000000003", "bbbbbbbb-0000-0000-0000-000000000001"]'::jsonb)),
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000002", "to": "bbbbbbbb-0000-0000-0000-000000000003"}]',
    '{"kcsPerPart": [], "partsWithoutKcs": [], "exercisesWithoutKcs": [], "duplicates": []}'),
  true, 'the build ends');
select results_eq(
  $$select t.name, k.name, tk.position from public.topic_kcs tk join public.topics t on t.id = tk.topic_id
    join public.kcs k on k.id = tk.kc_id order by tk.position$$,
  $$values ('Bases'::text, 'Basis'::text, 0), ('Bases', 'Vector', 1)$$,
  'the listed Topic holds its KCs in teaching order; the other Topic is gone');
select is((select count(*)::int from public.prerequisite_links), 2, 'the redundant Prerequisite is dropped');
select results_eq(
  $$select status, check_report ? 'duplicates' from public.knowledge_map_builds$$,
  $$values ('built'::text, true)$$,
  'the build is built with its check report');

select * from finish();
rollback;
