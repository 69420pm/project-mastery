-- The close call's store (#187): `store_session_close` writes the Session
-- note, the Topic note, the condensed Memory (only while the Memory is
-- unchanged since it was read) and the dated Memory lines (skipping one past
-- 4,000 characters) once per session. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rockets');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, why_it_matters, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'Thrust', 'How does an engine make thrust?', 'Every engine question starts here.', 0);

-- Each Chat starts a learn session: 1 with the Topic, 2 review, 3 learn
-- without a Topic, 4 in the Course without a Memory.
insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002');
update public.study_sessions set ended_at = now();
update public.study_sessions set topic_id = 'dddddddd-0000-0000-0000-000000000001', stage = 'close'
where chat_id = 'cccccccc-0000-0000-0000-000000000001';
update public.study_sessions set mode = 'review'
where chat_id = 'cccccccc-0000-0000-0000-000000000002';

insert into public.memories (course_id, owner, text)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  '!Exam is open book.' || chr(10) || 'Likes short answers.');

create temporary table ids on commit drop as
select chat_id, id from public.study_sessions;
create temporary table day on commit drop as
select to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ': ' as prefix;
grant select on ids, day to authenticated, service_role;

set local role service_role;

-- Guard on: the Memory is as read, so the condensed text replaces it.
select is(
  public.store_session_close(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000001'),
    'Worked through thrust.' || chr(10) || 'Next: nozzles.',
    array['Prefers worked examples.'],
    'Mixes up mass flow and velocity.',
    '!Exam is open book.',
    (select updated_at from public.memories)),
  true, 'the first store succeeds');
select is((select session_note from public.study_sessions
    where chat_id = 'cccccccc-0000-0000-0000-000000000001'),
  'Worked through thrust.' || chr(10) || 'Next: nozzles.', 'it stores the Session note');
select is((select text from public.topic_notes), 'Mixes up mass flow and velocity.',
  'it stores the Topic note');
select is((select owner from public.topic_notes), '11111111-1111-1111-1111-111111111111'::uuid,
  'the Topic note belongs to the session''s Student');
select is((select text from public.memories where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '!Exam is open book.' || chr(10) || (select prefix from day) || 'Prefers worked examples.',
  'it replaces the Memory with the condensed text and appends the dated line');

-- A second store of the same session changes nothing.
select is(
  public.store_session_close(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000001'),
    'Again.', array['Twice.'], 'Overwritten.'),
  false, 'a second store of the session is refused');
select is((select text from public.topic_notes), 'Mixes up mass flow and velocity.',
  'the second store leaves the Topic note');
select is((select text from public.memories where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '!Exam is open book.' || chr(10) || (select prefix from day) || 'Prefers worked examples.',
  'the second store appends no line');

-- The Memory changed since it was read: the condensed text is dropped, the
-- lines still appended; a review session writes no Topic note.
select is(
  public.store_session_close(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000002'),
    'Reviewed thrust.' || chr(10) || 'Next: more reviews.',
    array['Studies at night.'],
    'Not for review.',
    'Dropped.',
    '2000-01-01T00:00:00Z'),
  true, 'a store with a stale Memory read succeeds');
select is((select text from public.memories where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '!Exam is open book.' || chr(10) || (select prefix from day) || 'Prefers worked examples.'
    || chr(10) || (select prefix from day) || 'Studies at night.',
  'a changed Memory keeps its text and gets the line');
select is((select text from public.topic_notes), 'Mixes up mass flow and velocity.',
  'a review session leaves the Topic note');
reset role;

-- Guard off, with a nearly full Memory: a line past 4,000 characters is
-- skipped, a shorter one still fits.
update public.memories set text = repeat('x', 3980)
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role service_role;
select public.store_session_close(
  (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'),
  'Short session.' || chr(10) || 'Next: thrust.',
  array['This line is far too long to still fit.', 'ok']);
select is((select text from public.memories where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  repeat('x', 3980) || chr(10) || (select prefix from day) || 'ok',
  'a line past 4,000 characters is skipped and the next appended');

-- A Course without a Memory gets one, owned by the session's Student.
select public.store_session_close(
  (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000004'),
  'First session.' || chr(10) || 'Next: rockets.',
  array['Wants exam-style tasks.']);
select is(
  (select owner::text || ' ' || text from public.memories
    where course_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '11111111-1111-1111-1111-111111111111 ' || (select prefix from day) || 'Wants exam-style tasks.',
  'a store creates the Course''s Memory');
reset role;

-- Students cannot call it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$select public.store_session_close(
    (select id from ids where chat_id = 'cccccccc-0000-0000-0000-000000000003'),
    'Mine.', array[]::text[])$$,
  '42501', null, 'a Student cannot store a close');
reset role;

select * from finish();
rollback;
