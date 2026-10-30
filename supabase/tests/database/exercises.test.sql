-- Exercises of a Knowledge map (#70): an Exercise keeps its final answers
-- and KCs, and owners read their own rows and write none.
-- Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

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

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    0, 1, 1, 'exercise', 'Compute the efficiency.'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    1, 1, 1, 'solution', '46.5%');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Cycle', 'Brayton.', 0);

insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    'Thermal efficiency', 'η.', 'procedure', 'content', 0),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    'Propulsive power', 'F V0.', 'procedure', 'exercise', 1);

insert into public.exercises (id, owner, course_id, question_chunk_id, difficulty, position, final_answers)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 3, 0,
  '[{"label": "Thermal efficiency", "value": 0.508, "unit": null}]');

insert into public.exercise_kcs (exercise_id, kc_id, owner, course_id)
select 'eeeeeeee-0000-0000-0000-000000000001', id, owner, course_id
from public.kcs where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select results_eq(
  $$select k.name from public.exercise_kcs x join public.kcs k on k.id = x.kc_id
    where x.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by k.position$$,
  $$values ('Thermal efficiency'), ('Propulsive power')$$,
  'an exercise''s KCs point to the stored KCs');

-- Owners only, and Students cannot write.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.exercises) + (select count(*)::int from public.exercise_kcs),
  0, 'another Student reads no exercises');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select final_answers from public.exercises),
  '[{"label": "Thermal efficiency", "value": 0.508, "unit": null}]'::jsonb,
  'the owner reads their exercises with their final answers');
select throws_ok(
  $$delete from public.exercises$$,
  '42501', null, 'a Student cannot delete an exercise');
reset role;

select * from finish();
rollback;
