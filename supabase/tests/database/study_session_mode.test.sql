-- start_study_session_mode (#184): switches a new session from learn to review
-- or practice, only for its owner, while it runs, with no Topic and no
-- question. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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

-- 1 and 2 are Alice's fresh sessions, 3 is Bob's, 4 has ended, 5 has a Topic
-- and 6 has a question.
insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');

update public.study_sessions set ended_at = now()
where chat_id = 'cccccccc-0000-0000-0000-000000000004';
update public.study_sessions
set topic_id = 'dddddddd-0000-0000-0000-000000000001', stage = 'orient'
where chat_id = 'cccccccc-0000-0000-0000-000000000005';
insert into public.questions (owner, session_id, kind, prompt)
select owner, id, 'question', 'Why?' from public.study_sessions
where chat_id = 'cccccccc-0000-0000-0000-000000000006';

create temporary table ids on commit drop as
select chat_id, id from public.study_sessions;
grant select on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000001'), 'review'),
  true, 'the owner switches a fresh session to review');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000001'), 'practice'),
  false, 'a session that is no longer learn stays as it is');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'), 'practice'),
  true, 'the owner switches a fresh session to practice');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'), 'review'),
  false, 'another Student''s session stays learn');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000004'), 'review'),
  false, 'an ended session stays learn');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000005'), 'review'),
  false, 'a session with a Topic stays learn');
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000006'), 'review'),
  false, 'a session with a question stays learn');

reset role;
select results_eq(
  $$select chat_id, mode from public.study_sessions
    where chat_id::text like 'cccccccc-0000-0000-0000-00000000000_'
    order by chat_id$$,
  $$values
    ('cccccccc-0000-0000-0000-000000000001'::uuid, 'review'),
    ('cccccccc-0000-0000-0000-000000000002'::uuid, 'practice'),
    ('cccccccc-0000-0000-0000-000000000003'::uuid, 'learn'),
    ('cccccccc-0000-0000-0000-000000000004'::uuid, 'learn'),
    ('cccccccc-0000-0000-0000-000000000005'::uuid, 'learn'),
    ('cccccccc-0000-0000-0000-000000000006'::uuid, 'learn')$$,
  'only the two fresh sessions of the owner switched');

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  public.start_study_session_mode(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'), 'learn'),
  false, 'the mode learn changes nothing');

select * from finish();
