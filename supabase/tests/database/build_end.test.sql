-- The end of a build (#225, #229): Prerequisites from what KCs assume,
-- with their unit extractions marked matched, remaining duplicates and the
-- arranged map with its check report. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');
insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Lecture 1', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');
select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001',
  '[{"position": 0, "parent_position": null, "depth": 0, "title": "Lecture 1", "page_from": 1}]', '[]');
insert into public.chapter_extractions (id, chapter_id, owner, course_id, kind, unit, content_hash, output, kc_ids)
select 'eeeeeeee-0000-0000-0000-000000000001', id, owner, course_id, 'content', 0, repeat('a', 64),
  '{"kcs": [], "prerequisites": []}', '{}'
from public.chapters;

create function pg_temp.vec(axis int) returns extensions.vector language sql as $$
  select ('[' || array_to_string(array_agg(case when i = axis then 1 else 0 end order by i), ',') || ']')::extensions.vector
  from generate_series(1, 2048) as i
$$;

insert into public.kcs (id, owner, course_id, name, description, origin, position, embedding)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Vector', 'An element.', 'content', 0, pg_temp.vec(1)),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Vectors', 'Elements.', 'content', 1, pg_temp.vec(1)),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Basis', 'A spanning independent family.', 'content', 2, pg_temp.vec(3));

select results_eq(
  $$select a, b from public.alike_kcs('aaaaaaaa-0000-0000-0000-000000000001', 0.85, 10)$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid)$$,
  'alike_kcs lists each pair of alike live KCs once');

select is(
  public.store_assumed_prerequisites('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000003"},
      {"from": "bbbbbbbb-0000-0000-0000-000000000002", "to": "bbbbbbbb-0000-0000-0000-000000000003"},
      {"from": "bbbbbbbb-0000-0000-0000-000000000001", "to": "bbbbbbbb-0000-0000-0000-000000000002"}]',
    '{eeeeeeee-0000-0000-0000-000000000001}'),
  true, 'the running build stores assumed Prerequisites');
select is((select count(*)::int from public.prerequisite_links), 3, 'all three are stored');
select is((select assumes_matched from public.chapter_extractions), true,
  'the unit extraction is marked matched');

select is(
  public.arrange_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001',
    '["bbbbbbbb-0000-0000-0000-000000000003", "bbbbbbbb-0000-0000-0000-000000000001"]',
    '[{"from": "bbbbbbbb-0000-0000-0000-000000000002", "to": "bbbbbbbb-0000-0000-0000-000000000003"}]',
    '{"chaptersWithoutKcs": [], "exercisesWithoutKcs": [], "duplicates": []}'),
  true, 'the build ends');
select results_eq(
  $$select name, position from public.kcs order by position$$,
  $$values ('Basis'::text, 0), ('Vector', 1), ('Vectors', 2)$$,
  'the listed KCs come first in their order, the others after them');
select results_eq(
  $$select status, check_report ? 'chaptersWithoutKcs', (select count(*)::int from public.prerequisite_links)
    from public.knowledge_map_builds$$,
  $$values ('built'::text, true, 2)$$,
  'the build is built with its check report and the redundant Prerequisite dropped');

select * from finish();
rollback;
