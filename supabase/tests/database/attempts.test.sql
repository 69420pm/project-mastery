-- Study sessions, questions and graded attempts (#173): every Chat starts a
-- session; a Student asks questions only in their own sessions, tags them
-- only with their Course's KCs, records attempts only on a question's KCs,
-- reads only their own rows and never changes what was asked or graded. A
-- deleted Chat keeps its session; a deleted Course takes everything. Run
-- with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.kcs (id, owner, course_id, name, description, type, bloom, origin, position)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'F = ṁ Δv.', 'prior', null, 'prior', 0),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Nozzles', 'Accelerate the flow.', 'prior', null, 'prior', 1),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000002', 'Cells', 'Units of life.', 'prior', null, 'prior', 0);

insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002');

create temporary table ids on commit drop as
select
  (select id from public.study_sessions where chat_id = 'cccccccc-0000-0000-0000-000000000001') as alice_session,
  (select id from public.study_sessions where chat_id = 'cccccccc-0000-0000-0000-000000000002') as bob_session;
grant select on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$select id from public.study_sessions$$,
  $$select alice_session from ids$$,
  'a Student reads only their own session');
select throws_ok(
  $$insert into public.study_sessions (owner, course_id, mode)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'learn')$$,
  '42501', null, 'a Student cannot start a session themselves');

select lives_ok(
  $$insert into public.questions (session_id, kind, prompt)
    select alice_session, 'question', 'What is thrust?' from ids$$,
  'the owner asks a question in their session');
select throws_ok(
  $$insert into public.questions (session_id, kind, prompt)
    select bob_session, 'question', 'Sneaky?' from ids$$,
  '42501', null, 'a question in another Student''s session is refused');
select throws_ok(
  $$insert into public.questions (session_id, kind, prompt, exercise_id)
    select alice_session, 'problem', 'Ex. 9', 'dddddddd-0000-0000-0000-000000000009' from ids$$,
  '42501', null, 'an Exercise not of the Course is refused');

select lives_ok(
  $$insert into public.question_kcs (question_id, kc_id)
    select id, 'bbbbbbbb-0000-0000-0000-000000000001' from public.questions$$,
  'the owner tags the question with a KC of the Course');
select throws_ok(
  $$insert into public.question_kcs (question_id, kc_id)
    select id, 'bbbbbbbb-0000-0000-0000-000000000002' from public.questions$$,
  '42501', null, 'a KC of another Course is refused');

select lives_ok(
  $$update public.questions set answer_text = 'Mass flow times Δv.', answered_at = now()$$,
  'the owner answers the question');
select lives_ok(
  $$update public.questions set confidence = 4$$,
  'the owner stores how sure they were');
select throws_ok(
  $$update public.questions set confidence = 5$$,
  '23514', null, 'a confidence is from 1 to 4');
select throws_ok(
  $$update public.questions set prompt = 'Something else'$$,
  '42501', null, 'what was asked cannot be changed');

select lives_ok(
  $$insert into public.attempts (question_id, session_id, kc_id, kind, result, help, "check")
    select id, session_id, 'bbbbbbbb-0000-0000-0000-000000000001', 'learn', 'partial', 'some', 'mismatch'
    from public.questions$$,
  'the owner records an attempt on the question''s KC');
select results_eq(
  $$select owner, result, help, "check", created_at = now() from public.attempts$$,
  $$values ('11111111-1111-1111-1111-111111111111'::uuid, 'partial', 'some', 'mismatch', true)$$,
  'the owner reads it, owned by them and timed by the database');
select throws_ok(
  $$insert into public.attempts (question_id, session_id, kc_id, kind, result, help)
    select id, session_id, 'bbbbbbbb-0000-0000-0000-000000000003', 'learn', 'full', 'none'
    from public.questions$$,
  '42501', null, 'a KC the question does not test is refused');
select throws_ok(
  $$insert into public.attempts (question_id, session_id, kc_id, kind, result, help)
    select q.id, ids.bob_session, 'bbbbbbbb-0000-0000-0000-000000000001', 'learn', 'full', 'none'
    from public.questions q, ids$$,
  '42501', null, 'an attempt in another session than its question''s is refused');
select throws_ok(
  $$insert into public.attempts (question_id, session_id, kc_id, kind, result, help, created_at)
    select id, session_id, 'bbbbbbbb-0000-0000-0000-000000000001', 'learn', 'full', 'none', now() - interval '3 days'
    from public.questions$$,
  '42501', null, 'an attempt cannot be backdated');
select throws_ok(
  $$update public.attempts set result = 'full'$$,
  '42501', null, 'an attempt cannot be changed');

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.questions)
    + (select count(*)::int from public.question_kcs)
    + (select count(*)::int from public.attempts),
  0,
  'another Student reads none of the questions, their KCs or attempts');
reset role;

delete from public.chats where id = 'cccccccc-0000-0000-0000-000000000001';
select results_eq(
  $$select s.chat_id is null, count(a.id)::int from public.study_sessions s
    join public.attempts a on a.session_id = s.id
    where s.course_id = 'aaaaaaaa-0000-0000-0000-000000000001' group by s.chat_id$$,
  $$values (true, 1)$$,
  'a deleted Chat leaves its session and attempts');

delete from public.kcs where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select is((select count(*)::int from public.attempts), 0,
  'a deleted KC takes its attempts with it');

delete from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.study_sessions
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000001')
    + (select count(*)::int from public.questions),
  0,
  'a deleted Course takes its sessions and questions with it');

select * from finish();
rollback;
