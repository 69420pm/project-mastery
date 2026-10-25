-- Generated Problems (#183): only the workflow writes them, owners read
-- their own and may flag a ready one once, and a question may pose a ready
-- Problem of its session's Course. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rockets');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Chapter 7', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
  0, 1, 1, 'exercise', 'Compute the thrust.');

insert into public.exercises (id, owner, course_id, question_chunk_id, name, task_type,
  solution_status, difficulty, position)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
  'Ex. 7.2a', 'compute thrust', 'given', 2, 0);

insert into public.problems (id, owner, course_id, source, status, original_exercise_id,
  task_type, difficulty, statement, solution, final_answers, program, failure)
values
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'variant', 'ready',
    'eeeeeeee-0000-0000-0000-000000000001', 'compute thrust', 2,
    'An engine moves 50 kg/s.', 'F = 25 kN.',
    '[{"label": "Thrust", "value": 25000, "unit": "N"}]', 'F = 50 kg/s * 500 m/s', null),
  ('ffffffff-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'new', 'queued', null, null, 1,
    null, null, null, null, null),
  ('ffffffff-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'new', 'ready', null, null, 1,
    'A rocket.', 'Done.', null, null, null),
  ('ffffffff-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'new', 'ready', null, null, 1,
    'Another engine.', 'Done.', null, null, null);

select throws_ok(
  $$insert into public.problems (owner, course_id, source, status, difficulty)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'new', 'ready', 1)$$,
  '23514', null, 'a ready Problem has a statement and a solution');
select throws_ok(
  $$insert into public.problems (owner, course_id, source, status, difficulty)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'new', 'failed', 1)$$,
  '23514', null, 'a failed Problem says why');

insert into public.chats (id, owner, course_id)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001');

create temporary table ids on commit drop as
select id from public.study_sessions where chat_id = 'dddddddd-0000-0000-0000-000000000001';
grant select on ids to authenticated;

-- Reading and writing.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.problems), 0, 'another Student reads no Problems');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.problems), 4, 'the owner reads their Problems');
select throws_ok(
  $$insert into public.problems (owner, course_id, source, difficulty)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'new', 1)$$,
  '42501', null, 'a Student cannot write a Problem');
select throws_ok(
  $$update public.problems set statement = 'Easier.' where id = 'ffffffff-0000-0000-0000-000000000001'$$,
  '42501', null, 'a Student cannot change a Problem''s statement');

-- The flag.
update public.problems set flag = 'wrong' where id = 'ffffffff-0000-0000-0000-000000000001';
select results_eq(
  $$select flag, flagged_at is not null from public.problems where id = 'ffffffff-0000-0000-0000-000000000001'$$,
  $$values ('wrong', true)$$,
  'the owner flags a ready Problem, stamped by the database');
update public.problems set flag = 'unclear' where id = 'ffffffff-0000-0000-0000-000000000001';
select is(
  (select flag from public.problems where id = 'ffffffff-0000-0000-0000-000000000001'), 'wrong',
  'a flag is set once');
update public.problems set flag = 'unclear' where id = 'ffffffff-0000-0000-0000-000000000002';
select is(
  (select flag from public.problems where id = 'ffffffff-0000-0000-0000-000000000002'), null,
  'a queued Problem cannot be flagged');

-- Questions on a Problem.
select lives_ok(
  $$insert into public.questions (session_id, kind, prompt, problem_id)
    values ((select id from ids), 'problem', 'Compute it.', 'ffffffff-0000-0000-0000-000000000004')$$,
  'a question poses a ready Problem of its Course');
select throws_ok(
  $$insert into public.questions (session_id, kind, prompt, problem_id)
    values ((select id from ids), 'problem', 'Compute it.', 'ffffffff-0000-0000-0000-000000000002')$$,
  '42501', null, 'a question cannot pose a queued Problem');
select throws_ok(
  $$insert into public.questions (session_id, kind, prompt, problem_id)
    values ((select id from ids), 'problem', 'Compute it.', 'ffffffff-0000-0000-0000-000000000003')$$,
  '42501', null, 'a question cannot pose a Problem of another Course');
select throws_ok(
  $$insert into public.questions (session_id, kind, prompt, exercise_id, problem_id)
    values ((select id from ids), 'problem', 'Compute it.',
      'eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000004')$$,
  '23514', null, 'a question poses an Exercise or a Problem, not both');
reset role;

-- A deleted Exercise leaves its variant, and a deleted Problem its questions.
delete from public.exercises where id = 'eeeeeeee-0000-0000-0000-000000000001';
select is(
  (select original_exercise_id from public.problems where id = 'ffffffff-0000-0000-0000-000000000001'),
  null, 'a variant outlives its Exercise');
delete from public.problems where id = 'ffffffff-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.questions where session_id = (select id from ids) and problem_id is null),
  1, 'a question outlives its Problem');

select * from finish();
rollback;
