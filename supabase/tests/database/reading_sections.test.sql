-- Reading sections (#178): only the build workflow writes them through
-- replace_reading_sections, which keeps the rows of stored sections it names
-- by id (mode and texts stay), drops left-out ones and marks the build
-- built; owners read their own. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Chapter 7', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, why_it_matters, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'Thrust', 'Where does thrust come from?', '.', 0);

insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

-- The workflow stores two sections.
set local role service_role;
select is(
  public.replace_reading_sections('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"id": null, "topic": "dddddddd-0000-0000-0000-000000000001",
        "material": "aaaaaaaa-1111-0000-0000-000000000001", "position": 0,
        "pageFrom": 1, "pageTo": 2, "chunkIds": ["cccccccc-0000-0000-0000-000000000001"],
        "mode": "original", "reason": "Not judged yet.", "annotations": null, "studyText": null},
      {"id": null, "topic": "dddddddd-0000-0000-0000-000000000001",
        "material": "aaaaaaaa-1111-0000-0000-000000000001", "position": 1,
        "pageFrom": 3, "pageTo": 3, "chunkIds": ["cccccccc-0000-0000-0000-000000000002"],
        "mode": "original", "reason": "Not judged yet.", "annotations": null, "studyText": null}]'),
  true, 'a running build stores its sections');
reset role;
select results_eq(
  $$select position, page_from, page_to, chunk_ids, mode, reason, annotations is null
    from public.reading_sections where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by position$$,
  $$values (0, 1, 2, '{cccccccc-0000-0000-0000-000000000001}'::uuid[], 'original', 'Not judged yet.', true),
    (1, 3, 3, '{cccccccc-0000-0000-0000-000000000002}'::uuid[], 'original', 'Not judged yet.', true)$$,
  'sections are stored in order');
select is((select status from public.knowledge_map_builds
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'built', 'storing sections ends the build');

set local role service_role;
select is(
  public.replace_reading_sections('aaaaaaaa-0000-0000-0000-000000000001', '[]'),
  false, 'without a running build nothing is stored');
reset role;
select is((select count(*)::int from public.reading_sections where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2, 'the sections are unchanged');

-- An update keeps a named section's row and texts, moves it first and drops the other.
create temporary table kept as select id from public.reading_sections
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and position = 1;
grant select on kept to service_role;
update public.reading_sections set mode = 'study_text', reason = 'Dense.', study_text = 'Text. [p. 3]'
where position = 1;
update public.knowledge_map_builds set status = 'building'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select replace_reading_sections('aaaaaaaa-0000-0000-0000-000000000001',
  jsonb_build_array(
    jsonb_build_object('id', (select id from kept), 'topic', 'dddddddd-0000-0000-0000-000000000001',
      'material', 'aaaaaaaa-1111-0000-0000-000000000001', 'position', 0,
      'pageFrom', 3, 'pageTo', 3, 'chunkIds', '["cccccccc-0000-0000-0000-000000000002"]'::jsonb,
      'mode', 'original', 'reason', 'Not judged yet.', 'annotations', null, 'studyText', null)));
reset role;
select results_eq(
  $$select position, id = (select id from kept), mode, study_text from public.reading_sections
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values (0, true, 'study_text', 'Text. [p. 3]')$$,
  'a named section keeps its row and texts and a left-out one goes');

-- Students read their own sections and write none.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.reading_sections), 0,
  'another Student reads no sections');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.reading_sections), 1,
  'the owner reads their sections');
select throws_ok(
  $$delete from public.reading_sections$$,
  '42501', null, 'a Student cannot change sections');
select throws_ok(
  $$select public.replace_reading_sections('aaaaaaaa-0000-0000-0000-000000000001', '[]')$$,
  '42501', null, 'a Student cannot call replace_reading_sections');
reset role;

-- A build that reached its Daily limit stores what it judged and stays building.
update public.knowledge_map_builds set status = 'building'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select replace_reading_sections('aaaaaaaa-0000-0000-0000-000000000001', '[]', false);
reset role;
select is((select status from public.knowledge_map_builds
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'building', 'a partial store leaves the build running');

-- The mode and its text go together.
select throws_ok(
  $$insert into public.reading_sections (owner, course_id, topic_id, material_id, position,
      page_from, page_to, chunk_ids, mode, reason)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 5,
      1, 1, '{cccccccc-0000-0000-0000-000000000001}', 'annotated', 'Gaps.')$$,
  '23514', null, 'an annotated section needs its notes');

select * from finish();
rollback;
