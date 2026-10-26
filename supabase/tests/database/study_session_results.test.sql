-- start_study_session_mode with results (#186): only on the caller's graded
-- mock of the session's Course, which it sets as the session's mock_id. Run
-- with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rockets'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Biology');

-- 1 is Alice's graded mock, 2 her submitted one, 3 her graded mock of
-- another Course and 4 Bob's graded mock.
insert into public.mock_exams (id, owner, course_id, status, duration_minutes, predicted_score, started_at, graded_at)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'graded', 18, 9, now(), now()),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'submitted', 18, 9, now(), null),
  ('dddddddd-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'graded', 18, 9, now(), now()),
  ('dddddddd-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000003', 'graded', 18, 9, now(), now());

insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');

create temporary table ids on commit drop as
select chat_id, id from public.study_sessions;
grant select on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'), 'results'),
  false, 'results needs a mock');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'), 'results',
    'dddddddd-0000-0000-0000-000000000002'),
  false, 'a mock not graded yet starts no results session');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'), 'results',
    'dddddddd-0000-0000-0000-000000000003'),
  false, 'nor a graded mock of another Course');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'), 'results',
    'dddddddd-0000-0000-0000-000000000004'),
  false, 'nor another Student''s graded mock');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'), 'review',
    'dddddddd-0000-0000-0000-000000000001'),
  false, 'review takes no mock');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000001'), 'results',
    'dddddddd-0000-0000-0000-000000000001'),
  true, 'the owner starts results on their graded mock');

reset role;
select results_eq(
  $$select chat_id, mode, mock_id from public.study_sessions
    where chat_id::text like 'cccccccc-0000-0000-0000-00000000000_'
    order by chat_id$$,
  $$values
    ('cccccccc-0000-0000-0000-000000000001'::uuid, 'results', 'dddddddd-0000-0000-0000-000000000001'::uuid),
    ('cccccccc-0000-0000-0000-000000000002'::uuid, 'learn', null::uuid)$$,
  'only that session is in results, with its mock');

select * from finish();
rollback;
