-- A Chat's session goes through a Mock exam (#251): `set_session_mock`
-- accepts only the caller's own graded mock of the session's Course, and
-- only while the session has no Question. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rockets'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.mock_exams (id, owner, course_id, status, duration_minutes, predicted_score, graded_at)
select id::uuid, owner::uuid, course_id::uuid, status, duration, predicted,
  case when status = 'graded' then now() end
from (values
  -- Graded, in the Chat's Course.
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'graded', 18, 9),
  -- Not graded yet.
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'submitted', 18, 9),
  -- Graded, in another Course.
  ('dddddddd-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'graded', 18, 9),
  -- Graded, another Student's.
  ('dddddddd-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000003', 'graded', 18, 9)
) as mock (id, owner, course_id, status, duration, predicted);

-- Each new Chat starts its session.
insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.questions (owner, session_id, prompt)
select owner, id, 'Why?' from public.study_sessions
where chat_id = 'cccccccc-0000-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(public.set_session_mock('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002'),
  false, 'a mock not yet graded is refused');
select is(public.set_session_mock('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000003'),
  false, 'a mock of another Course is refused');
select is(public.set_session_mock('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004'),
  false, 'another Student''s mock is refused');
select is(public.set_session_mock('cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001'),
  false, 'a session with a Question is refused');
select is(public.set_session_mock('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001'),
  true, 'the owner''s graded mock of the Course is set');

reset role;

select results_eq(
  $$select chat_id, mock_id from public.study_sessions order by chat_id$$,
  $$values ('cccccccc-0000-0000-0000-000000000001'::uuid, 'dddddddd-0000-0000-0000-000000000001'::uuid),
    ('cccccccc-0000-0000-0000-000000000002'::uuid, null::uuid)$$,
  'only the session without a Question goes through the mock');

select * from finish();
rollback;
