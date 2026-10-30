-- public.exercise_solutions and the pairing functions (#59): owners read
-- their own pairs, only the workflow writes them, and a pass whose request
-- is no longer the latest writes nothing. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analysis');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Sheet 7', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
    'parsed'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Solutions 7', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000002',
    'parsed');

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown, exercise_number)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    0, 1, 1, 'exercise', 'a) Show ...', '7.2a'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
    1, 1, 1, 'exercise', 'b) Prove ...', '7.2b'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000002',
    0, 1, 1, 'solution', 'a) Since ...', '7.2a');

-- Students cannot request or write a pairing pass.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$select public.request_exercise_pairing('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', null, 'a Student cannot request a pairing pass');
select throws_ok(
  $$select public.replace_exercise_solutions('aaaaaaaa-0000-0000-0000-000000000001', 1, '[]')$$,
  '42501', null, 'a Student cannot write pairs');
select throws_ok(
  $$insert into public.exercise_solutions (owner, course_id, exercise_chunk_id, status)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000001', 'no_solution')$$,
  '42501', null, 'a Student cannot insert a pair');
reset role;

-- Two requests: the first pass is no longer the latest and writes nothing.
set local role service_role;
select is(public.request_exercise_pairing('aaaaaaaa-0000-0000-0000-000000000001'), 1::bigint,
  'the first request is number 1');
select is(public.request_exercise_pairing('aaaaaaaa-0000-0000-0000-000000000001'), 2::bigint,
  'a later request is number 2');
select is(
  public.replace_exercise_solutions('aaaaaaaa-0000-0000-0000-000000000001', 1,
    '[{"exercise_chunk_id": "cccccccc-0000-0000-0000-000000000001", "solution_chunk_id": null}]'),
  false, 'a pass of an earlier request writes nothing');
select is(
  public.replace_exercise_solutions('aaaaaaaa-0000-0000-0000-000000000001', 2,
    '[{"exercise_chunk_id": "cccccccc-0000-0000-0000-000000000001", "solution_chunk_id": "cccccccc-0000-0000-0000-000000000003"},
      {"exercise_chunk_id": "cccccccc-0000-0000-0000-000000000002", "solution_chunk_id": null,
       "candidates_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'),
  true, 'the latest request''s pass writes its pairs');
reset role;

select results_eq(
  $$select exercise_chunk_id, solution_chunk_id, status, owner, course_id, candidates_hash
    from public.exercise_solutions
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    order by exercise_chunk_id$$,
  $$values
    ('cccccccc-0000-0000-0000-000000000001'::uuid, 'cccccccc-0000-0000-0000-000000000003'::uuid, 'paired',
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, null::text),
    ('cccccccc-0000-0000-0000-000000000002'::uuid, null::uuid, 'no_solution',
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      repeat('a', 64))$$,
  'pairs are stored as paired or no_solution, owned like the Course, with the memo of their call');

-- Owners only.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.exercise_solutions), 2, 'the owner reads their pairs');
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.exercise_solutions), 0, 'another Student reads none');
reset role;

-- Deleting the solution Material removes its exercise's pair.
delete from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000002';
select is(
  (select count(*)::int from public.exercise_solutions
    where exercise_chunk_id = 'cccccccc-0000-0000-0000-000000000001'),
  0, 'deleting the solution removes the pair');

-- A pass skips chunks deleted meanwhile instead of failing.
set local role service_role;
select is(
  public.replace_exercise_solutions('aaaaaaaa-0000-0000-0000-000000000001', 2,
    '[{"exercise_chunk_id": "cccccccc-0000-0000-0000-000000000001", "solution_chunk_id": "cccccccc-0000-0000-0000-000000000003"},
      {"exercise_chunk_id": "cccccccc-0000-0000-0000-000000000002", "solution_chunk_id": null}]'),
  true, 'a pass naming a deleted solution still writes');
reset role;
select is(
  (select status from public.exercise_solutions
    where exercise_chunk_id = 'cccccccc-0000-0000-0000-000000000001'),
  'no_solution', 'an exercise whose solution is gone has no solution');

select * from finish();
rollback;
