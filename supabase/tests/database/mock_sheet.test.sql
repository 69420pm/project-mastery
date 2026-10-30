-- start_mock_exam, the answer trigger and submit_mock_exam (#185): only the
-- owner starts a ready mock, it gets a session without a Chat and one
-- Question per item with its KCs, and answers close after the deadline or
-- the submit. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

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

insert into public.exercises (id, owner, course_id, question_chunk_id, difficulty, position)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 2, 0);

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('9b9b9b9b-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Propulsion', 'How engines push.', 0);

insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', '9b9b9b9b-0000-0000-0000-000000000001',
  'Thrust', 'F = ṁ Δv.', 'fact', 'content', 0);

insert into public.exercise_kcs (exercise_id, kc_id, owner, course_id)
values ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.mock_exams (id, owner, course_id, status, duration_minutes, predicted_score)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'ready', 18, 9),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'assembling', null, null);

insert into public.mock_items (mock_id, owner, position, exercise_id, prompt, points, predicted_success)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 0,
    'eeeeeeee-0000-0000-0000-000000000001', 'Compute the thrust.', 12, 0.5),
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
    null, 'Name the stages.', 6, 0.5);

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.start_mock_exam('dddddddd-0000-0000-0000-000000000001'), false,
  'another Student cannot start the mock');

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.start_mock_exam('dddddddd-0000-0000-0000-000000000002'), false,
  'a mock still assembling does not start');
select is(public.start_mock_exam('dddddddd-0000-0000-0000-000000000001'), true,
  'the owner starts a ready mock');
select is(public.start_mock_exam('dddddddd-0000-0000-0000-000000000001'), false,
  'a started mock does not start again');

select is(
  (select status from public.mock_exams where id = 'dddddddd-0000-0000-0000-000000000001'),
  'in_progress', 'the mock is in progress');
select is(
  (select s.mode || ', chat ' || coalesce(s.chat_id::text, 'none')
   from public.study_sessions s
   join public.mock_exams m on m.session_id = s.id
   where m.id = 'dddddddd-0000-0000-0000-000000000001'),
  'mock, chat none', 'in a mock session without a Chat');
select is(
  (select count(*)::int from public.mock_items i
   join public.questions q on q.id = i.question_id
   where q.kind = 'mock_item' and q.prompt = i.prompt),
  2, 'each item is asked as a mock_item Question');
select is(
  (select array_agg(qk.kc_id) from public.mock_items i
   join public.question_kcs qk on qk.question_id = i.question_id),
  array['bbbbbbbb-0000-0000-0000-000000000001'::uuid],
  'tagged with its Exercise''s KCs');

select lives_ok(
  $$update public.questions set answer_text = '25 kN', confidence = 3, answered_at = now()
    where kind = 'mock_item' and exercise_id is not null$$,
  'the Student answers while it runs');
select lives_ok(
  $$update public.questions set graded_at = now() where kind = 'mock_item'$$,
  'other columns are not checked');

reset role;
update public.mock_exams set started_at = now() - interval '20 minutes'
where id = 'dddddddd-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$update public.questions set answer_text = 'late' where kind = 'mock_item'$$,
  '55000', null, 'an answer after the deadline is refused');

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.submit_mock_exam('dddddddd-0000-0000-0000-000000000001'), false,
  'another Student cannot submit the mock');

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.submit_mock_exam('dddddddd-0000-0000-0000-000000000001'), true,
  'the owner submits it');
select is(
  (select m.status || ' at ' || (m.submitted_at = m.started_at + interval '19 minutes')
     || ', session ended ' || (s.ended_at = m.submitted_at)
   from public.mock_exams m join public.study_sessions s on s.id = m.session_id
   where m.id = 'dddddddd-0000-0000-0000-000000000001'),
  'submitted at true, session ended true',
  'past its deadline it is submitted at the deadline, and its session ends');

reset role;
update public.mock_exams set started_at = now()
where id = 'dddddddd-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$update public.questions set confidence = 1 where kind = 'mock_item'$$,
  '55000', null, 'an answer after the submit is refused');
select is(
  (select answer_text from public.questions where kind = 'mock_item' and exercise_id is not null),
  '25 kN', 'the submitted answer stays');

select * from finish();
rollback;
