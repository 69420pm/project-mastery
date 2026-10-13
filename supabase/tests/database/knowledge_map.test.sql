-- The Knowledge map tables and functions (#69): a Student starts one build at
-- a time, only the workflow writes the map, a replace swaps the whole map,
-- and owners read their own rows. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

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
  $$select public.replace_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001', '{}', '{}')$$,
  '42501', null, 'a Student cannot write the map');
select throws_ok(
  $$insert into public.big_ideas (owner, course_id, name, description, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'x', 'y', 0)$$,
  '42501', null, 'a Student cannot insert a big idea');
reset role;

-- The workflow swaps in a map, skipping a source whose chunk is gone.
delete from public.chunks where id = 'cccccccc-0000-0000-0000-000000000002';
set local role service_role;
select is(
  public.replace_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001',
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
    '{"uncoveredChunks": []}'),
  true, 'a running build writes its map');
reset role;

select results_eq(
  $$select k.name, k.position, b.name, (select count(*)::int from public.kc_sources s where s.kc_id = k.id)
    from public.kcs k left join public.big_ideas b on b.id = k.big_idea_id
    order by k.position$$,
  $$values ('Newton''s laws', 0, null::text, 0), ('Thrust', 1, 'Thrust', 1), ('Thrust equation', 2, 'Thrust', 1)$$,
  'KCs are stored in order with their big idea and existing sources');
select results_eq(
  $$select f.name, t.name, l.extraction_confidence
    from public.prerequisite_links l
    join public.kcs f on f.id = l.from_kc join public.kcs t on t.id = l.to_kc
    order by f.position$$,
  $$values ('Newton''s laws', 'Thrust', 0.9::numeric), ('Thrust', 'Thrust equation', 0.6::numeric)$$,
  'prerequisites point to the stored KCs');
select is((select count(*)::int from public.semantic_links where core_type = 'other' and label = 'quantifies'), 1,
  'semantic links are stored');
select results_eq(
  $$select status, failure_reason, check_report, finished_at is not null from public.knowledge_map_builds$$,
  $$values ('built', null::text, '{"uncoveredChunks": []}'::jsonb, true)$$,
  'the build is built with its report');

-- A replace without a running build writes nothing.
set local role service_role;
select is(
  public.replace_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001',
    '{"bigIdeas": [], "kcs": [], "prerequisites": [], "semanticLinks": []}', '{}'),
  false, 'a replace without a running build writes nothing');
reset role;
select is((select count(*)::int from public.kcs), 3, 'the map is unchanged');

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
