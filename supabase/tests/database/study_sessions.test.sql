-- Study sessions (#174, #180): a Student writes `ended_at`, `rating` and
-- `rating_note` on their own session only, and no other column of it. The
-- Topic and stage change only through their functions, on the caller's own
-- running session. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'Thrust', 'How does an engine make thrust?', 0);

insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');

create temporary table ids on commit drop as
select chat_id, id from public.study_sessions;
grant select on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- The Topic and stage.
select is(
  public.start_study_session_topic(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'),
    'dddddddd-0000-0000-0000-000000000001', 'review'),
  true, 'the owner''s first reply sets the Topic and start stage');
select is(
  public.start_study_session_topic(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'),
    'dddddddd-0000-0000-0000-000000000001', 'orient'),
  false, 'a set Topic stays fixed');
select is(
  public.set_study_session_stage(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'), 'close'),
  true, 'the owner moves their session to a stage');
select is(
  public.set_study_session_stage(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'), 'work'),
  false, 'a session at close stays there');
select is(
  public.start_study_session_topic(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'),
    'dddddddd-0000-0000-0000-000000000001', 'orient'),
  false, 'another Student''s session gets no Topic');
select throws_ok(
  $$update public.study_sessions set stage = 'work'
    where chat_id = 'cccccccc-0000-0000-0000-000000000003'$$,
  '42501', null, 'a Student cannot write the stage');

-- Ending and rating.
select lives_ok(
  $$update public.study_sessions set ended_at = now()
    where chat_id = 'cccccccc-0000-0000-0000-000000000001'$$,
  'the owner ends their session');
select lives_ok(
  $$update public.study_sessions set rating = 4, rating_note = 'Clear.'
    where chat_id = 'cccccccc-0000-0000-0000-000000000001'$$,
  'the owner rates their session');
select lives_ok(
  $$update public.study_sessions set ended_at = now(), rating = 1
    where chat_id = 'cccccccc-0000-0000-0000-000000000002'$$,
  'ending or rating another Student''s session does not raise');
select throws_ok(
  $$update public.study_sessions set mode = 'review'
    where chat_id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '42501', null, 'a Student cannot change any other column of their session');

reset role;

select results_eq(
  $$select chat_id, ended_at is not null, rating, rating_note from public.study_sessions
    where chat_id in ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002')
    order by chat_id$$,
  $$values ('cccccccc-0000-0000-0000-000000000001'::uuid, true, 4::smallint, 'Clear.'),
    ('cccccccc-0000-0000-0000-000000000002'::uuid, false, null, null)$$,
  'only the owner''s session ended and was rated');
select results_eq(
  $$select topic_id, stage from public.study_sessions
    where chat_id = 'cccccccc-0000-0000-0000-000000000003'$$,
  $$values ('dddddddd-0000-0000-0000-000000000001'::uuid, 'close')$$,
  'the session keeps its Topic at close');

select * from finish();
