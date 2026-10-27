-- Topic notes and Session notes (#187): the service role writes them, the
-- owner reads them and nobody else does, a Topic note is capped at 1,500
-- characters and goes with its Topic. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, why_it_matters, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'Thrust', 'How does an engine make thrust?', 'Every engine question starts here.', 0);

insert into public.chats (id, owner, course_id)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001');

-- The service role writes the notes.
set local role service_role;
select lives_ok(
  $$insert into public.topic_notes (topic_id, owner, text)
    values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mixes up mass flow and velocity.')$$,
  'the service role writes a Topic note');
select lives_ok(
  $$update public.study_sessions set session_note = 'Covered thrust.' || chr(10) || 'Next: drag.',
    close_started_at = now()$$,
  'the service role writes the Session note and the claim');
select throws_ok(
  $$update public.topic_notes set text = repeat('x', 1501)$$,
  '23514', null, 'a Topic note over 1,500 characters is refused');
reset role;

-- The owner reads both and writes neither.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select text from public.topic_notes), 'Mixes up mass flow and velocity.',
  'the owner reads the Topic note');
select is((select session_note from public.study_sessions), 'Covered thrust.' || chr(10) || 'Next: drag.',
  'the owner reads the Session note');
select isnt((select close_started_at from public.study_sessions), null,
  'the owner reads the claim');
select throws_ok(
  $$update public.topic_notes set text = 'Mine.'$$,
  '42501', null, 'the owner cannot write the Topic note');
select throws_ok(
  $$insert into public.topic_notes (topic_id, owner, text)
    values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Again.')$$,
  '42501', null, 'the owner cannot add a Topic note');
select throws_ok(
  $$update public.study_sessions set session_note = 'Mine.'$$,
  '42501', null, 'the owner cannot write the Session note');
select throws_ok(
  $$update public.study_sessions set close_started_at = null$$,
  '42501', null, 'the owner cannot clear the claim');

-- Another Student reads neither.
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.topic_notes), 0,
  'another Student reads no Topic note');
reset role;

-- A Topic note goes with its Topic.
delete from public.topics;
select is((select count(*)::int from public.topic_notes), 0,
  'deleting the Topic deletes its note');

select * from finish();
rollback;
