-- Exam scopes and old exams of the Brief (#224): set_exam_scope writes a
-- Student's own scopes only, the Student reads and deletes their own rows,
-- and save_brief sets the old exams. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-c000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra'),
  ('bbbbbbbb-c000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.briefs (course_id, owner, reserved_exam_answered)
values
  ('aaaaaaaa-c000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', false),
  ('bbbbbbbb-c000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', false);

insert into public.materials (id, owner, course_id, name, storage_path, media_type, size_bytes, parse_status)
values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'Klausur', '11111111-1111-1111-1111-111111111111/aaaaaaaa-c000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000000f1', 'application/pdf', 10, 'parsed'),
  ('aaaaaaaa-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'Lecture', '11111111-1111-1111-1111-111111111111/aaaaaaaa-c000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000000f2', 'application/pdf', 10, 'parsing'),
  ('aaaaaaaa-0000-0000-0000-0000000000f3', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'Notes', '11111111-1111-1111-1111-111111111111/aaaaaaaa-c000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000000f3', 'application/pdf', 10, 'parsed');

-- Matrices holds Determinants; Cells is Bob's.
insert into public.topics (id, owner, course_id, parent_id, chapter_ids, name, central_question, position)
values
  ('aaaaaaaa-b000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', null, '{}', 'Matrices', null, 0),
  ('aaaaaaaa-7000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-b000-0000-0000-000000000001', '{aaaaaaaa-1111-0000-0000-000000000001}', 'Determinants', 'Why?', 1),
  ('bbbbbbbb-b000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-c000-0000-0000-000000000001', null, '{bbbbbbbb-1111-0000-0000-000000000001}', 'Cells', 'C?', 0);

-- The Materials' root Chapters, and an old exam inside the Notes.
insert into public.chapters (id, owner, course_id, material_id, parent_id, position, depth, title, page_from)
values
  ('aaaaaaaa-0c00-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f1', null, 0, 0, 'Klausur', 1),
  ('aaaaaaaa-0c00-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f2', null, 0, 0, 'Lecture', 1),
  ('aaaaaaaa-0c00-0000-0000-0000000000f3', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f3', null, 0, 0, 'Notes', 1),
  ('aaaaaaaa-0c00-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f3', 'aaaaaaaa-0c00-0000-0000-0000000000f3', 1, 1, 'Probeklausur', 5);

update public.briefs set updated_at = '2026-01-01' where course_id = 'aaaaaaaa-c000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Exam scopes ----------------------------------------------------------------

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', topic_id => 'aaaaaaaa-b000-0000-0000-000000000001', scope => 'excluded', words => 'Chapter 2 is out'),
  'set_exam_scope stores a scope of a Topic holding only Topics');

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', topic_id => 'aaaaaaaa-b000-0000-0000-000000000001', scope => 'emphasized', words => 'Matrices matter'),
  'set_exam_scope replaces it');

select results_eq(
  $$select scope, words from public.exam_scopes$$,
  $$values ('emphasized', 'Matrices matter')$$,
  'one row per Topic, with the Student''s words');

select ok(
  (select updated_at > '2026-01-01' from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'),
  'set_exam_scope bumps the Brief''s updated_at');

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', topic_id => 'aaaaaaaa-7000-0000-0000-000000000001', scope => 'excluded', words => 'No determinants'),
  'set_exam_scope stores a scope of a Topic inside it');

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', topic_id => 'aaaaaaaa-b000-0000-0000-000000000001'),
  'scope null removes the outer Topic''s scope');

select results_eq(
  $$select topic_id from public.exam_scopes$$,
  $$values ('aaaaaaaa-7000-0000-0000-000000000001'::uuid)$$,
  'only the Topic''s scope is left');

select is(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', topic_id => 'bbbbbbbb-b000-0000-0000-000000000001', scope => 'excluded', words => 'x'),
  false,
  'set_exam_scope refuses another Course''s Topic');

select is(
  public.set_exam_scope('bbbbbbbb-c000-0000-0000-000000000001', topic_id => 'bbbbbbbb-b000-0000-0000-000000000001', scope => 'excluded', words => 'x'),
  false,
  'set_exam_scope refuses another Student''s Brief');

select throws_ok(
  $$insert into public.exam_scopes (owner, course_id, topic_id, scope, words) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-b000-0000-0000-000000000001', 'excluded', 'x')$$,
  '42501', null, 'a Student cannot insert an exam scope directly');

-- Old exams -------------------------------------------------------------------

update public.briefs set reserved_exam_answered = true where course_id = 'aaaaaaaa-c000-0000-0000-000000000001';
select public.save_brief(
  'aaaaaaaa-c000-0000-0000-000000000001',
  '{"reserved_exam_chapter_id": "aaaaaaaa-0c00-0000-0000-0000000000e3"}',
  exam_chapter_ids => array['aaaaaaaa-0c00-0000-0000-0000000000f1', 'aaaaaaaa-0c00-0000-0000-0000000000e3']::uuid[],
  asked_chapter_ids => array['aaaaaaaa-0c00-0000-0000-0000000000f1', 'aaaaaaaa-0c00-0000-0000-0000000000f2', 'aaaaaaaa-0c00-0000-0000-0000000000e3']::uuid[]);

select results_eq(
  $$select title, is_exam, exam_asked from public.chapters order by title$$,
  $$values ('Klausur', true, true), ('Lecture', false, false), ('Notes', null::boolean, false), ('Probeklausur', true, true)$$,
  'save_brief sets the old-exam Chapters, answers the asked ones, and marks those of parsed Materials asked');

select results_eq(
  $$select reserved_exam_chapter_id from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  $$values ('aaaaaaaa-0c00-0000-0000-0000000000e3'::uuid)$$,
  'an old exam inside a script can be reserved');

select public.save_brief('aaaaaaaa-c000-0000-0000-000000000001', exam_chapter_ids => array['aaaaaaaa-0c00-0000-0000-0000000000f1']::uuid[]);

select results_eq(
  $$select b.reserved_exam_chapter_id, b.reserved_exam_answered, c.is_exam from public.briefs b, public.chapters c where b.course_id = 'aaaaaaaa-c000-0000-0000-000000000001' and c.title = 'Probeklausur'$$,
  $$values (null::uuid, false, false)$$,
  'a Reserved exam that is no longer an old exam loses its reservation');

-- Another Student ---------------------------------------------------------------

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
delete from public.exam_scopes;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.exam_scopes), 1, 'another Student neither reads nor deletes the scopes');

reset role;

select * from finish();
rollback;
