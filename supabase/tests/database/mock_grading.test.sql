-- Mock grading (#186): the submit marks grading started, only the owner
-- restarts a stalled grading, Students cannot write the grading columns,
-- and exam results are the Student's own and insert-only. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Rockets');

insert into public.mock_exams (id, owner, course_id, status, duration_minutes, predicted_score, started_at)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'in_progress', 18, 9, now()),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'submitted', 18, 9, now());

insert into public.mock_items (id, mock_id, owner, position, prompt, points, predicted_success)
values ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002',
  '11111111-1111-1111-1111-111111111111', 0, 'Name the stages.', 6, 0.5);

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(public.submit_mock_exam('dddddddd-0000-0000-0000-000000000001'), true,
  'the owner submits the mock');
select isnt(
  (select grading_started_at from public.mock_exams where id = 'dddddddd-0000-0000-0000-000000000001'),
  null, 'the submit marks its grading started');
select is(public.restart_mock_grading('dddddddd-0000-0000-0000-000000000001'), false,
  'grading that started just now does not restart');

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.restart_mock_grading('dddddddd-0000-0000-0000-000000000002'), false,
  'another Student cannot restart the grading');

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.restart_mock_grading('dddddddd-0000-0000-0000-000000000002'), true,
  'the owner restarts grading that never started');
select is(public.restart_mock_grading('dddddddd-0000-0000-0000-000000000002'), false,
  'and only once within the hour');

select throws_ok(
  $$update public.mock_exams set status = 'graded', score = 18, graded_at = now()
    where id = 'dddddddd-0000-0000-0000-000000000002'$$,
  '42501', null, 'a Student cannot grade their mock');
select throws_ok(
  $$update public.mock_items set points_awarded = 6, graded_at = now()$$,
  '42501', null, 'a Student cannot award points');

select lives_ok(
  $$insert into public.exam_results (course_id, exam_date, grade)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-20', '1.7')$$,
  'the Student records their exam''s grade');
select is(
  (select owner from public.exam_results),
  '11111111-1111-1111-1111-111111111111'::uuid, 'as their own row');
select throws_ok(
  $$insert into public.exam_results (course_id, exam_date, grade)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-20', null)$$,
  '23505', null, 'once per exam date');
select throws_ok(
  $$update public.exam_results set grade = '1.0'$$,
  '42501', null, 'and never changes it');
select throws_ok(
  $$insert into public.exam_results (course_id, exam_date)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '2026-10-20')$$,
  '42501', null, 'nor records one for another Student''s Course');

select * from finish();
rollback;
