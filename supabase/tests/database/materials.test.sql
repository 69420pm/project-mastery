-- Row Level Security and checks for public.materials. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- Two Students, each with a Course and a Material. The signup trigger
-- creates their profiles.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Linear Algebra'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Thermodynamics');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path)
values
  (
    'aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Lecture 1', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001'
  ),
  (
    'bbbbbbbb-1111-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
    'bbbbbbbb-0000-0000-0000-000000000001', 'Exam 2024', 'image/png', 2000,
    '22222222-2222-2222-2222-222222222222/bbbbbbbb-0000-0000-0000-000000000001/bbbbbbbb-1111-0000-0000-000000000001'
  );

select policies_are(
  'public',
  'materials',
  array[
    'Students can read their own materials',
    'Students can add materials to their own courses',
    'Students can update their own materials',
    'Students can delete their own materials'
  ],
  'materials has exactly the expected policies'
);

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.materials', '42501', null, 'anon has no access to materials');

-- Alice, signed in.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select name from public.materials',
  array['Lecture 1'],
  'a Student sees only their own materials'
);

select lives_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
    values ('aaaaaaaa-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'image/webp', 20971520,
      '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000002')$$,
  'a Student adds a material of exactly 20 MB to their own course, owned by them'
);

select throws_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
    values ('aaaaaaaa-1111-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Sneaky', 'image/png', 10,
      '11111111-1111-1111-1111-111111111111/bbbbbbbb-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000003')$$,
  '42501',
  null,
  'a Student cannot add a material to another Student''s course'
);

select throws_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
    values ('aaaaaaaa-1111-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Too big', 'image/png', 20971521,
      '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000004')$$,
  '23514',
  null,
  'a material over 20 MB is refused'
);

select throws_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
    values ('aaaaaaaa-1111-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'Word', 'application/msword', 10,
      '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000005')$$,
  '23514',
  null,
  'other file types are refused'
);

select throws_ok(
  $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
    values ('aaaaaaaa-1111-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 'Elsewhere', 'image/png', 10,
      '11111111-1111-1111-1111-111111111111/elsewhere')$$,
  '23514',
  null,
  'a storage path other than <owner>/<course>/<material> is refused'
);

select throws_ok(
  format(
    $$insert into public.materials (id, course_id, name, media_type, size_bytes, storage_path)
      values ('aaaaaaaa-1111-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', %L, 'image/png', 10,
        '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000007')$$,
    repeat('x', 201)
  ),
  '23514',
  null,
  'a name over 200 characters is refused'
);

select lives_ok(
  $$update public.materials set name = 'Lecture 1 (annotated)' where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  'a Student renames their own material'
);

select throws_ok(
  $$update public.materials set size_bytes = 1 where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  '42501',
  null,
  'only the name is updatable'
);

update public.materials set name = 'Hijacked' where id = 'bbbbbbbb-1111-0000-0000-000000000001';
delete from public.materials where id = 'bbbbbbbb-1111-0000-0000-000000000001';
delete from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000002';

reset role;

select is(
  (select name from public.materials where id = 'bbbbbbbb-1111-0000-0000-000000000001'),
  'Exam 2024',
  'a Student cannot rename or delete another Student''s material'
);

select is(
  (select count(*)::int from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000002'),
  0,
  'a Student deletes their own material'
);

delete from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.materials where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'deleting a course deletes its materials'
);

select * from finish();
rollback;
