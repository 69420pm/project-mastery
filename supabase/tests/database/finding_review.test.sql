-- Findings as a review queue (#85): a Student answers their own Findings
-- through the review columns only, and a scope Finding is a kind. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.findings (id, owner, course_id, kind, text, position)
values ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'scope',
  'Slides 12–15 say heat exchangers are not examined. Should we skip them?', 0);

select is((select status from public.findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'open', 'a new Finding is open');

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
update public.findings set status = 'answered', answer = 'No', answered_at = now();
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select status from public.findings), 'open', 'another Student cannot answer it');

select lives_ok(
  $$update public.findings set asked_at = now(), status = 'answered',
      answer = 'Yes, skip them.', answered_at = now()$$,
  'the owner answers their Finding');
select throws_ok(
  $$update public.findings set text = 'Changed'$$,
  '42501', null, 'the owner cannot change its text');
select throws_ok(
  $$update public.findings set status = 'open'$$,
  '23514', null, 'an open Finding has no answer');
reset role;
select results_eq(
  $$select status, answer from public.findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values ('answered', 'Yes, skip them.')$$,
  'the answer is stored');

select throws_ok(
  $$insert into public.findings (owner, course_id, kind, text, position)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'contradiction', 'x', 1)$$,
  '23514', null, 'only known kinds are stored');

select * from finish();
rollback;
