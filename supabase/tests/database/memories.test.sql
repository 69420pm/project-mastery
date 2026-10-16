-- The Memory the AI keeps per Course (#107): a Student writes and edits the
-- Memory of their own Course only, another Student neither reads nor writes
-- it, it is capped at 4,000 characters, and it goes with its Course. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Biology');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$insert into public.memories (course_id, text)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Likes examples.')$$,
  'the owner creates the Memory of their Course');
select lives_ok(
  $$update public.memories set text = 'Prefers short answers.'$$,
  'the owner edits it');
select results_eq(
  $$select owner, text from public.memories$$,
  $$values ('11111111-1111-1111-1111-111111111111'::uuid, 'Prefers short answers.')$$,
  'the owner reads it, owned by them');
select throws_ok(
  $$insert into public.memories (course_id, text)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'Mine now.')$$,
  '42501', null, 'the Memory of another Student''s Course is refused');
select throws_ok(
  $$update public.memories set course_id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', null, 'it cannot move to another Student''s Course');
select throws_ok(
  $$update public.memories set text = repeat('x', 4001)$$,
  '23514', null, 'more than 4,000 characters is refused');

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.memories), 0,
  'another Student reads no Memory');
update public.memories set text = 'Overwritten.';
select throws_ok(
  $$insert into public.memories (course_id, text)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Overwritten.')$$,
  '42501', null, 'another Student cannot write it');
reset role;
select is((select text from public.memories), 'Prefers short answers.',
  'another Student''s update changed nothing');

delete from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.memories), 0,
  'a deleted Course takes its Memory with it');

select * from finish();
rollback;
