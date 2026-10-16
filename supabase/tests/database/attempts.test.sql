-- The attempts log (#103): a Student records attempts only on KCs of their
-- own Course, reads only their own, never changes or backdates one, and a
-- deleted KC takes its attempts with it. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.kcs (id, owner, course_id, name, description, type, bloom, origin, position)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'F = ṁ Δv.', 'prior', null, 'prior', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-0000-0000-0000-000000000002', 'Cells', 'Units of life.', 'prior', null, 'prior', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$insert into public.attempts (course_id, kc_id, correct, help)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', true, 'some')$$,
  'the owner records an attempt on a KC of their Course');
select results_eq(
  $$select owner, correct, help, created_at = now() from public.attempts$$,
  $$values ('11111111-1111-1111-1111-111111111111'::uuid, true, 'some', true)$$,
  'the owner reads it, owned by them and timed by the database');
select throws_ok(
  $$insert into public.attempts (course_id, kc_id, correct, help)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', true, 'none')$$,
  '42501', null, 'a KC of another Course is refused');
select throws_ok(
  $$insert into public.attempts (course_id, kc_id, exercise_id, correct, help)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000009', true, 'none')$$,
  '42501', null, 'an Exercise not of the Course is refused');
select throws_ok(
  $$insert into public.attempts (course_id, kc_id, correct, help, created_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
      true, 'none', now() - interval '3 days')$$,
  '42501', null, 'an attempt cannot be backdated');
select throws_ok(
  $$update public.attempts set correct = false$$,
  '42501', null, 'an attempt cannot be changed');

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.attempts), 0,
  'another Student reads no attempts');
reset role;

delete from public.kcs where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select is((select count(*)::int from public.attempts), 0,
  'a deleted KC takes its attempts with it');

select * from finish();
rollback;
