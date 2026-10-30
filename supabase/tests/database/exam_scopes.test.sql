-- Exam scopes and old exams of the Brief (#224): set_exam_scope writes a
-- Student's own scopes only, the Student reads and deletes their own rows,
-- and save_brief sets the old exams. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

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

insert into public.big_ideas (id, owner, course_id, name, description, position)
values
  ('aaaaaaaa-b000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'Matrices', 'M.', 0),
  ('bbbbbbbb-b000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-c000-0000-0000-000000000001', 'Cells', 'C.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, position)
values ('aaaaaaaa-7000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-b000-0000-0000-000000000001', 'Determinants', 'Why?', 0);

update public.briefs set updated_at = '2026-01-01' where course_id = 'aaaaaaaa-c000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Exam scopes ----------------------------------------------------------------

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', big_idea_id => 'aaaaaaaa-b000-0000-0000-000000000001', scope => 'excluded', words => 'Chapter 2 is out'),
  'set_exam_scope stores a scope of the Student''s Big idea');

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', big_idea_id => 'aaaaaaaa-b000-0000-0000-000000000001', scope => 'emphasized', words => 'Matrices matter'),
  'set_exam_scope replaces it');

select results_eq(
  $$select scope, words from public.exam_scopes$$,
  $$values ('emphasized', 'Matrices matter')$$,
  'one row per Big idea, with the Student''s words');

select ok(
  (select updated_at > '2026-01-01' from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'),
  'set_exam_scope bumps the Brief''s updated_at');

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', topic_id => 'aaaaaaaa-7000-0000-0000-000000000001', scope => 'excluded', words => 'No determinants'),
  'set_exam_scope stores a Topic''s scope');

select ok(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', big_idea_id => 'aaaaaaaa-b000-0000-0000-000000000001'),
  'scope null removes the Big idea''s scope');

select results_eq(
  $$select topic_id from public.exam_scopes$$,
  $$values ('aaaaaaaa-7000-0000-0000-000000000001'::uuid)$$,
  'only the Topic''s scope is left');

select is(
  public.set_exam_scope('aaaaaaaa-c000-0000-0000-000000000001', big_idea_id => 'bbbbbbbb-b000-0000-0000-000000000001', scope => 'excluded', words => 'x'),
  false,
  'set_exam_scope refuses another Course''s Big idea');

select is(
  public.set_exam_scope('bbbbbbbb-c000-0000-0000-000000000001', big_idea_id => 'bbbbbbbb-b000-0000-0000-000000000001', scope => 'excluded', words => 'x'),
  false,
  'set_exam_scope refuses another Student''s Brief');

select throws_ok(
  $$insert into public.exam_scopes (owner, course_id, big_idea_id, scope, words) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-b000-0000-0000-000000000001', 'excluded', 'x')$$,
  '42501', null, 'a Student cannot insert an exam scope directly');

-- Old exams -------------------------------------------------------------------

update public.briefs set reserved_exam_answered = true where course_id = 'aaaaaaaa-c000-0000-0000-000000000001';
select public.save_brief('aaaaaaaa-c000-0000-0000-000000000001', '{"reserved_exam_material_id": "aaaaaaaa-0000-0000-0000-0000000000f1"}', exam_material_ids => array['aaaaaaaa-0000-0000-0000-0000000000f1']::uuid[], asked_material_ids => array['aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000f2']::uuid[]);

select results_eq(
  $$select name, is_exam, exam_asked from public.materials order by name$$,
  $$values ('Klausur', true, true), ('Lecture', false, false), ('Notes', false, false)$$,
  'save_brief sets the old exams and marks the parsed Materials the question listed asked');

select public.save_brief('aaaaaaaa-c000-0000-0000-000000000001', exam_material_ids => array[]::uuid[]);

select results_eq(
  $$select reserved_exam_material_id, reserved_exam_answered from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  $$values (null::uuid, false)$$,
  'a Reserved exam that is no longer an old exam loses its reservation');

-- Another Student ---------------------------------------------------------------

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
delete from public.exam_scopes;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.exam_scopes), 1, 'another Student neither reads nor deletes the scopes');

reset role;

select * from finish();
rollback;
