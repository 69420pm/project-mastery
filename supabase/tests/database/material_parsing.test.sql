-- Parse state on public.materials, and Row Level Security of
-- public.material_pages and public.chunks. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Linear Algebra'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Thermodynamics');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values
  (
    'aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Lecture 1', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
    'parsed'
  ),
  (
    'bbbbbbbb-1111-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-0000-0000-0000-000000000001', 'Exam 2024', 'image/png', 2000,
    '22222222-2222-2222-2222-222222222222/bbbbbbbb-0000-0000-0000-000000000001/bbbbbbbb-1111-0000-0000-000000000001',
    'parsed'
  );

-- The workflow's rows, written as the service role.
insert into public.material_pages (owner, material_id, page_number, units)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-0000-0000-000000000001', 1, '[]'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-0000-0000-000000000001', 1, '[]');

insert into public.chunks (owner, course_id, material_id, position, page_from, page_to, label, markdown)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-1111-0000-0000-000000000001', 0, 1, 1, 'content', 'A *vector space* is ...'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-1111-0000-0000-000000000001', 0, 1, 1, 'exercise', 'Compute $\Delta S$.');

select policies_are('public', 'material_pages', array['Students can read their own material pages'],
  'material_pages has only the read policy');
select policies_are('public', 'chunks', array['Students can read their own chunks'],
  'chunks has only the read policy');

select throws_ok(
  $$insert into public.chunks (owner, course_id, material_id, position, page_from, page_to, label, markdown)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-1111-0000-0000-000000000001', 1, 1, 1, 'gossip', 'x')$$,
  '23514', null, 'a chunk label is one of the seven');

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.chunks', '42501', null, 'anon has no access to chunks');
select throws_ok('select * from public.material_pages', '42501', null, 'anon has no access to material pages');

-- Alice, signed in.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq('select markdown from public.chunks', array['A *vector space* is ...'],
  'a Student reads only their own chunks');
select results_eq('select material_id from public.material_pages', array['aaaaaaaa-1111-0000-0000-000000000001'::uuid],
  'a Student reads only their own material pages');

select throws_ok(
  $$insert into public.chunks (owner, course_id, material_id, position, page_from, page_to, label, markdown)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-1111-0000-0000-000000000001', 1, 1, 1, 'content', 'forged')$$,
  '42501', null, 'a Student cannot add chunks');
select throws_ok($$update public.chunks set markdown = 'edited'$$, '42501', null,
  'a Student cannot change chunks');
select throws_ok($$delete from public.chunks$$, '42501', null, 'a Student cannot delete chunks');
select throws_ok(
  $$insert into public.material_pages (owner, material_id, page_number, units)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-0000-0000-000000000001', 2, '[]')$$,
  '42501', null, 'a Student cannot add material pages');

-- Parse columns are the workflow's.
select throws_ok(
  $$update public.materials set parse_status = 'queued' where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  '42501', null, 'a Student cannot change the parse status');
select throws_ok(
  $$update public.materials set is_exam = true, exam_year = 2024 where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  '42501', null, 'a Student cannot change the exam metadata');
select throws_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path, parse_status)
    values ('aaaaaaaa-1111-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'Forged', 'image/png', 10,
      '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000009', 'parsed')$$,
  '42501', null, 'a Student cannot upload a Material as already parsed');

select lives_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
    values ('aaaaaaaa-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'image/png', 10,
      '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000002')$$,
  'a Student uploads a Material');
select results_eq(
  $$select parse_status from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000002'$$,
  array['queued'], 'a new upload waits for its parse');

-- Deleting the Material takes its pages and chunks along.
delete from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000001';
reset role;
select results_eq(
  $$select count(*)::int from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001'
    union all select count(*)::int from public.material_pages where material_id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  array[0, 0], 'deleting a Material deletes its chunks and pages');

-- Skipped pages: a reason from the list, and no units.
select lives_ok(
  $$insert into public.material_pages (owner, material_id, page_number, units, skipped)
    values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-0000-0000-000000000001', 2, '[]', 'unreadable')$$,
  'an unreadable page is stored without units');
select throws_ok(
  $$insert into public.material_pages (owner, material_id, page_number, units, skipped)
    values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-0000-0000-000000000001', 3, '[]', 'boring')$$,
  '23514', null, 'a page is skipped only for a known reason');
select throws_ok(
  $$insert into public.material_pages (owner, material_id, page_number, units, skipped)
    values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-0000-0000-000000000001', 3, '[{"markdown": "x"}]', 'blank')$$,
  '23514', null, 'a skipped page has no units');
select throws_ok(
  $$insert into public.chunks (owner, course_id, material_id, position, page_from, page_to, label, markdown)
    values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001',
      'bbbbbbbb-1111-0000-0000-000000000001', 1, 1, 1, 'definition', 'x')$$,
  '23514', null, 'a chunk has one of the four labels');

select * from finish();
rollback;
