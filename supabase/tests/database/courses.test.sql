-- Row Level Security and checks for public.courses. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- Two Students. The signup trigger creates their profiles.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name, updated_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Linear Algebra', '2026-01-01'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Thermodynamics', '2026-01-01');

select policies_are(
  'public',
  'courses',
  array[
    'Students can read their own courses',
    'Students can create their own courses',
    'Students can update their own courses',
    'Students can delete their own courses'
  ],
  'courses has exactly the expected policies'
);

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.courses', '42501', null, 'anon has no access to courses');

-- Alice, signed in.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select name from public.courses',
  array['Linear Algebra'],
  'a Student sees only their own courses'
);

select lives_ok(
  $$insert into public.courses (id, name) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Linear Algebra')$$,
  'a Student creates a course, owned by them, with a name they already used'
);

select is(
  (select owner from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'a new course belongs to the Student who created it'
);

select throws_ok(
  $$insert into public.courses (owner, name) values ('22222222-2222-2222-2222-222222222222', 'Sneaky')$$,
  '42501',
  null,
  'a Student cannot create a course for someone else'
);

select throws_ok(
  $$insert into public.courses (name) values ('   ')$$,
  '23514',
  null,
  'a blank name is refused'
);

select throws_ok(
  $$insert into public.courses (name) values (' Padded ')$$,
  '23514',
  null,
  'an untrimmed name is refused'
);

select throws_ok(
  format('insert into public.courses (name) values (%L)', repeat('x', 101)),
  '23514',
  null,
  'a name over 100 characters is refused'
);

select lives_ok(
  $$update public.courses set name = 'Linear Algebra II' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'a Student renames their own course'
);

select throws_ok(
  $$update public.courses set owner = '22222222-2222-2222-2222-222222222222' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'only the name is updatable'
);

update public.courses set name = 'Hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
delete from public.courses where id = 'bbbbbbbb-0000-0000-0000-000000000001';

reset role;

select is(
  (select name from public.courses where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'Thermodynamics',
  'a Student cannot rename or delete another Student''s course'
);

select is(
  (select updated_at from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  now(),
  'renaming a course sets updated_at'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

delete from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000002';

reset role;

select is(
  (select count(*)::int from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'a Student deletes their own course'
);

select * from finish();
rollback;
