-- public.replace_material_chunks: the parse workflow's one-transaction write
-- of a Material's chunks and exam metadata. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analysis');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values (
  'aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Exam 2023', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsing'
);

-- An earlier parse's chunk.
insert into public.chunks (owner, course_id, material_id, position, page_from, page_to, label, markdown)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-1111-0000-0000-000000000001', 0, 1, 1, 'content', 'Old chunk');

-- Students cannot call it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001', '[]', false, null, null)$$,
  '42501', null, 'a Student cannot replace chunks');
reset role;

set local role service_role;
select lives_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[
      {"position": 0, "page_from": 1, "page_to": 2, "label": "definition", "markdown": "A limit ...", "figure": null, "exercise_number": null, "points": null},
      {"position": 1, "page_from": 3, "page_to": 3, "label": "exercise", "markdown": "a) Show ...", "figure": {"description": "A plot", "cropPath": null}, "exercise_number": "7.2a", "points": 2.5}
    ]',
    true, 2023, 60)$$,
  'the workflow replaces the chunks');
reset role;

select results_eq(
  $$select position, page_from, page_to, label, markdown, exercise_number, points, owner, course_id
    from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001' order by position$$,
  $$values
    (0, 1, 2, 'definition', 'A limit ...', null::text, null::numeric,
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
    (1, 3, 3, 'exercise', 'a) Show ...', '7.2a', 2.5,
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'the new chunks replace the old one, owned like the Material');

select is(
  (select figure from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001' and position = 1),
  '{"description": "A plot", "cropPath": null}'::jsonb,
  'a chunk keeps its figure');

select results_eq(
  $$select is_exam, exam_year, exam_total_points from public.materials
    where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  $$values (true, 2023, 60::numeric)$$,
  'the exam metadata is stored on the Material');

-- A bad chunk rolls back the whole write: the earlier chunks stay.
set local role service_role;
select throws_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[{"position": 0, "page_from": 1, "page_to": 1, "label": "gossip", "markdown": "x", "figure": null, "exercise_number": null, "points": null}]',
    false, null, null)$$,
  '23514', null, 'an invalid chunk fails the write');
reset role;

select is(
  (select count(*)::int from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  2, 'a failed write keeps the earlier chunks');

-- Not an exam: the metadata is cleared.
set local role service_role;
select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001', '[]', false, 2023, 60);
reset role;
select results_eq(
  $$select is_exam, exam_year, exam_total_points from public.materials
    where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  $$values (false, null::integer, null::numeric)$$,
  'a Material that is not an exam has no exam year or points');

select * from finish();
rollback;
