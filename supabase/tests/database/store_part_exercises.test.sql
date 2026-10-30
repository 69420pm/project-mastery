-- Exercises stored by store_part_kcs (#225): by question chunk, in place,
-- with their printed solution's chunk. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');
insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Sheet 2', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001', 'parsed');
insert into public.parts (id, owner, course_id, material_id, position, kind, title, chapter_title, page_from, page_to, content_hash)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 0, 'exercise',
  'Sheet 2', 'Sheet 2', 1, 1, repeat('a', 64));
insert into public.chunks (id, owner, course_id, material_id, part_id, position, page_from, page_to, label, markdown)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    'eeeeeeee-0000-0000-0000-000000000001', 0, 1, 1, 'exercise', 'Find dim U.'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    'eeeeeeee-0000-0000-0000-000000000001', 1, 1, 1, 'solution', 'dim U = 2.');
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');

create function pg_temp.store(p_solution text, p_new_kc text) returns boolean language sql as $$
  select public.store_part_kcs(
    'aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('id', p_new_kc, 'new', true,
      'name', 'Dimension ' || p_new_kc, 'description', 'Dim.', 'type', 'concept', 'origin', 'exercise',
      'bigIdea', 'Sheet 2', 'sources', jsonb_build_array('cccccccc-0000-0000-0000-000000000001'))),
    '[]',
    jsonb_build_array(jsonb_build_object(
      'partId', 'eeeeeeee-0000-0000-0000-000000000001', 'kcIds', jsonb_build_array(p_new_kc),
      'exercises', jsonb_build_array(jsonb_build_object(
        'questionChunkId', 'cccccccc-0000-0000-0000-000000000001', 'solutionChunkId', p_solution,
        'kcIds', jsonb_build_array(p_new_kc), 'difficulty', 2,
        'finalAnswers', '[{"label": "dim U", "value": 2, "unit": null}]'::jsonb)))))
$$;

select is(pg_temp.store('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001'),
  true, 'the running build stores an exercise Part');
select results_eq(
  $$select solution_chunk_id, difficulty::int, final_answers -> 0 ->> 'value', (select k.origin from public.kcs k join public.exercise_kcs x on x.kc_id = k.id)
    from public.exercises$$,
  $$values ('cccccccc-0000-0000-0000-000000000002'::uuid, 2, '2', 'exercise')$$,
  'the Exercise keeps its printed solution, final answers and the new KC it tests');

create temp table first_id as select id from public.exercises;

select pg_temp.store(null, 'bbbbbbbb-0000-0000-0000-000000000002');
select results_eq(
  $$select id, solution_chunk_id from public.exercises$$,
  $$select id, null::uuid from first_id$$,
  'extracted again, the Exercise keeps its id');
select results_eq(
  $$select k.name from public.exercise_kcs x join public.kcs k on k.id = x.kc_id$$,
  $$values ('Dimension bbbbbbbb-0000-0000-0000-000000000002')$$,
  'and tests only its new KCs');
select results_eq(
  $$select kc_id from public.kc_sources$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000002'::uuid)$$,
  'the earlier extraction''s KC loses its source on the statement');

select pg_temp.store('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003');
delete from public.chunks where id = 'cccccccc-0000-0000-0000-000000000002';
select is((select solution_chunk_id from public.exercises), null,
  'a deleted solution chunk leaves the Exercise without one');

select is(
  public.arrange_knowledge_map('aaaaaaaa-0000-0000-0000-000000000001', '["Sheet 2"]', '[]')
    and (select position from public.exercises) = 0,
  true, 'the build ends with the Exercises in Course order');

select * from finish();
rollback;
