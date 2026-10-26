-- queue_mock_exam and release_mock_exam (#185): a Course has one open mock,
-- only its owner queues one, one assembling for over an hour fails, and
-- Students read but never write mocks. Run with `pnpm db:test`.
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

create temporary table queued (n int, mock_id uuid, queued boolean) on commit drop;
grant all on queued to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

insert into queued
select 1, * from public.queue_mock_exam('aaaaaaaa-0000-0000-0000-000000000001');
insert into queued
select 2, * from public.queue_mock_exam('aaaaaaaa-0000-0000-0000-000000000001');

select is((select queued from queued where n = 1), true, 'the first call queues a mock');
select is(
  (select mock_id from queued where n = 2),
  (select mock_id from queued where n = 1),
  'the second call returns the open mock');
select is((select queued from queued where n = 2), false, 'and queues none');
select is(
  (select count(*)::int from public.queue_mock_exam('aaaaaaaa-0000-0000-0000-000000000002')),
  0, 'another Student''s Course queues nothing');
select throws_ok(
  $$insert into public.mock_exams (owner, course_id)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', null, 'a Student cannot insert a mock');

reset role;
-- The open mock has assembled for two hours.
update public.mock_exams set created_at = now() - interval '2 hours';

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
insert into queued
select 3, * from public.queue_mock_exam('aaaaaaaa-0000-0000-0000-000000000001');

select is((select queued from queued where n = 3), true, 'a mock assembling for over an hour no longer blocks a new one');
select is(
  (select status || ': ' || failure from public.mock_exams
   where id = (select mock_id from queued where n = 1)),
  'failed: Assembling took longer than an hour.',
  'and it failed');

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  public.release_mock_exam((select mock_id from queued where n = 3)),
  false, 'another Student cannot release the mock');
select is((select count(*)::int from public.mock_exams), 0, 'nor read it');

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(
  public.release_mock_exam((select mock_id from queued where n = 3)),
  true, 'the owner releases a mock whose workflow could not start');

select * from finish();
