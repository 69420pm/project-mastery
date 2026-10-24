-- Ending Study sessions (#174): a Student writes `ended_at` on their own
-- session only, and no other column of it. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.chats (id, owner, course_id)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$update public.study_sessions set ended_at = now()
    where chat_id = 'cccccccc-0000-0000-0000-000000000001'$$,
  'the owner ends their session');
select lives_ok(
  $$update public.study_sessions set ended_at = now()
    where chat_id = 'cccccccc-0000-0000-0000-000000000002'$$,
  'ending another Student''s session does not raise');
select throws_ok(
  $$update public.study_sessions set mode = 'review'
    where chat_id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '42501', null, 'a Student cannot change any other column of their session');

reset role;

select results_eq(
  $$select chat_id, ended_at is not null from public.study_sessions
    where chat_id in ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002')
    order by chat_id$$,
  $$values ('cccccccc-0000-0000-0000-000000000001'::uuid, true),
    ('cccccccc-0000-0000-0000-000000000002'::uuid, false)$$,
  'only the owner''s session ended');

select * from finish();
