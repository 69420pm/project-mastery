-- The Knowledge map tables and functions (#69): a Student starts one build at
-- a time, only the workflow writes the map, an update keeps the rows it
-- names by id (#83), and owners read their own rows. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

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

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    0, 1, 1, 'content', 'Thrust is ...'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    1, 1, 1, 'content', 'F = ...');

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
  $$select public.apply_knowledge_map_update('aaaaaaaa-0000-0000-0000-000000000001', '{}', '{}', '{}')$$,
  '42501', null, 'a Student cannot write the map');
select throws_ok(
  $$insert into public.big_ideas (owner, course_id, name, description, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'x', 'y', 0)$$,
  '42501', null, 'a Student cannot insert a big idea');
reset role;

-- The workflow writes the first map, skipping a source and a processed chunk
-- whose chunk is gone.
delete from public.chunks where id = 'cccccccc-0000-0000-0000-000000000002';
set local role service_role;
select is(
  public.apply_knowledge_map_update('aaaaaaaa-0000-0000-0000-000000000001',
    '{"bigIdeas": [{"id": "b1", "name": "Thrust", "description": "Momentum makes thrust."}],
      "kcs": [
        {"id": "k1", "name": "Newton''s laws", "description": "Force pairs.", "type": "prior",
          "bloom": null, "bigIdea": null, "origin": "prior", "sources": []},
        {"id": "k2", "name": "Thrust", "description": "Net forward force.", "type": "fact",
          "bloom": "remember", "bigIdea": "b1", "origin": "content",
          "sources": ["cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002"]},
        {"id": "k3", "name": "Thrust equation", "description": "F = ...", "type": "procedure",
          "bloom": "apply", "bigIdea": "b1", "origin": "content",
          "sources": ["cccccccc-0000-0000-0000-000000000001"]}],
      "prerequisites": [{"from": "k1", "to": "k2", "extractionConfidence": 0.9},
        {"from": "k2", "to": "k3", "extractionConfidence": 0.6}],
      "semanticLinks": [{"from": "k3", "to": "k2", "coreType": "other", "label": "quantifies"}]}',
    '{cccccccc-0000-0000-0000-000000000001,cccccccc-0000-0000-0000-000000000002}',
    '{"uncoveredChunks": []}'),
  true, 'a running build writes its map');
reset role;
select is((select array_agg(chunk_id) from public.knowledge_map_chunks
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '{cccccccc-0000-0000-0000-000000000001}'::uuid[], 'the update records its existing chunks');

select results_eq(
  $$select k.name, k.position, b.name, (select count(*)::int from public.kc_sources s where s.kc_id = k.id)
    from public.kcs k left join public.big_ideas b on b.id = k.big_idea_id
    where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    order by k.position$$,
  $$values ('Newton''s laws', 0, null::text, 0), ('Thrust', 1, 'Thrust', 1), ('Thrust equation', 2, 'Thrust', 1)$$,
  'KCs are stored in order with their big idea and existing sources');
select results_eq(
  $$select f.name, t.name, l.extraction_confidence
    from public.prerequisite_links l
    join public.kcs f on f.id = l.from_kc join public.kcs t on t.id = l.to_kc
    where l.course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    order by f.position$$,
  $$values ('Newton''s laws', 'Thrust', 0.9::numeric), ('Thrust', 'Thrust equation', 0.6::numeric)$$,
  'prerequisites point to the stored KCs');
select is((select count(*)::int from public.semantic_links
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and core_type = 'other' and label = 'quantifies'), 1,
  'semantic links are stored');
select results_eq(
  $$select status, failure_reason, check_report, finished_at is not null from public.knowledge_map_builds
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values ('building', null::text, '{"uncoveredChunks": []}'::jsonb, false)$$,
  'the build stores its report and runs on to the Topics');
-- Storing the Topics ends the build.
set local role service_role;
select is(public.replace_topics('aaaaaaaa-0000-0000-0000-000000000001', '[]'), true,
  'the build stores its Topics');
reset role;
select results_eq(
  $$select status, finished_at is not null from public.knowledge_map_builds
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values ('built', true)$$,
  'storing the Topics marks the build built');

-- An update without a running build writes nothing.
set local role service_role;
select is(
  public.apply_knowledge_map_update('aaaaaaaa-0000-0000-0000-000000000001',
    '{"bigIdeas": [], "kcs": [], "prerequisites": [], "semanticLinks": []}', '{}', '{}'),
  false, 'an update without a running build writes nothing');
reset role;
select is((select count(*)::int from public.kcs where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 3,
  'the map is unchanged');

-- A later update keeps the rows the map names by id, drops the ones it
-- leaves out and appends new ones.
create temporary table kept as
  select k.id as kc, k.big_idea_id as big_idea from public.kcs k
  where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and k.name = 'Thrust';
grant select on kept to service_role;
update public.knowledge_map_builds set status = 'building'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select is(
  public.apply_knowledge_map_update('aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_object(
      'bigIdeas', jsonb_build_array(jsonb_build_object('id', (select big_idea from kept),
        'name', 'Ignored', 'description', 'Ignored.')),
      'kcs', jsonb_build_array(
        jsonb_build_object('id', (select kc from kept), 'name', 'Thrust',
          'description', 'Net forward force.', 'type', 'fact', 'bloom', 'remember',
          'bigIdea', (select big_idea from kept), 'origin', 'content',
          'sources', '["cccccccc-0000-0000-0000-000000000001"]'::jsonb),
        jsonb_build_object('id', 'k1', 'name', 'Specific thrust', 'description', 'F / mdot.',
          'type', 'concept', 'bloom', 'understand', 'bigIdea', (select big_idea from kept),
          'origin', 'content', 'sources', '["cccccccc-0000-0000-0000-000000000001"]'::jsonb)),
      'prerequisites', jsonb_build_array(jsonb_build_object(
        'from', (select kc from kept), 'to', 'k1', 'extractionConfidence', 0.7)),
      'semanticLinks', '[]'::jsonb),
    '{}', '{}'),
  true, 'a running build writes its update');
reset role;
select results_eq(
  $$select k.name, k.position, k.id = (select kc from kept), b.name
    from public.kcs k join public.big_ideas b on b.id = k.big_idea_id
    where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by k.position$$,
  $$values ('Thrust', 1, true, 'Thrust'), ('Specific thrust', 2, false, 'Thrust')$$,
  'a kept KC keeps its id and big idea, a new one comes after, a left-out one goes');
select is((select count(*)::int from public.prerequisite_links
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1, 'links are the update''s');

-- A kept KC moves to a new big idea while its old one is left out: it keeps
-- its id, place, sources, Prerequisites and Attempts, and takes the map's
-- fields.
insert into kept (kc)
  select k.id from public.kcs k
  where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and k.name = 'Specific thrust';
with session as (
  insert into public.study_sessions (owner, course_id, mode)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'learn')
  returning id
), question as (
  insert into public.questions (owner, session_id, kind, prompt)
  select '11111111-1111-1111-1111-111111111111', id, 'question', 'Why?' from session
  returning id, session_id
)
insert into public.attempts (owner, question_id, session_id, kc_id, kind, result, help)
  select '11111111-1111-1111-1111-111111111111', question.id, question.session_id, kc,
    'learn', 'full', 'none'
  from kept, question where big_idea is not null;
update public.knowledge_map_builds set status = 'building'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select is(
  public.apply_knowledge_map_update('aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_object(
      'bigIdeas', jsonb_build_array(jsonb_build_object('id', 'b2',
        'name', 'Propulsion', 'description', 'Engines push.')),
      'kcs', jsonb_build_array(
        jsonb_build_object('id', (select kc from kept where big_idea is not null),
          'name', 'Net thrust', 'description', 'Forward force.', 'type', 'concept',
          'bloom', 'understand', 'bigIdea', 'b2', 'origin', 'content',
          'sources', '["cccccccc-0000-0000-0000-000000000001"]'::jsonb),
        jsonb_build_object('id', (select kc from kept where big_idea is null),
          'name', 'Specific thrust', 'description', 'F / mdot.', 'type', 'concept',
          'bloom', 'understand', 'bigIdea', 'b2', 'origin', 'content',
          'sources', '["cccccccc-0000-0000-0000-000000000001"]'::jsonb)),
      'prerequisites', jsonb_build_array(jsonb_build_object(
        'from', (select kc from kept where big_idea is not null),
        'to', (select kc from kept where big_idea is null), 'extractionConfidence', 0.7)),
      'semanticLinks', '[]'::jsonb),
    '{}', '{}'),
  true, 'an update that moves a KC off a left-out big idea succeeds');
reset role;
select results_eq(
  $$select k.id = (select kc from kept where big_idea is not null), k.position, k.name, k.type,
      b.name, (select count(*)::int from public.kc_sources s where s.kc_id = k.id),
      (select count(*)::int from public.prerequisite_links l where l.from_kc = k.id),
      (select count(*)::int from public.attempts a where a.kc_id = k.id)
    from public.kcs k join public.big_ideas b on b.id = k.big_idea_id
    where k.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by k.position$$,
  $$values (true, 1, 'Net thrust', 'concept', 'Propulsion', 1, 1, 1),
    (false, 2, 'Specific thrust', 'concept', 'Propulsion', 1, 0, 0)$$,
  'a moved KC keeps its id, place, sources, Prerequisites and Attempts under its new big idea');
select is((select array_agg(name) from public.big_ideas
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '{Propulsion}'::text[], 'the left-out big idea is gone');
-- As the Topics stage would end it.
update public.knowledge_map_builds set status = 'built'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';

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
