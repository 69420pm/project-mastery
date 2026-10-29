-- The generate run per Course (#183): a Student queues one run at a time on
-- their own Course, for a Topic of it or the review stock, a running run
-- drops the next call unless it is an hour old, and only the workflow
-- writes the row. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Bob''s');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
  'aaaaaaaa-0000-0000-0000-000000000002', 'Thrust', 'Thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, position)
values ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
  'aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
  'Thrust', 'How much?', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.queue_problem_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'another Student cannot start a run');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_problem_run('aaaaaaaa-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001'), false,
  'a Topic of another Course starts no run');
select is(public.queue_problem_run('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'the owner starts a review run');
select is(public.queue_problem_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'a call while it runs is dropped');
select results_eq(
  $$select status, stock, topic_id from public.problem_runs$$,
  $$values ('running', 'review', null::uuid)$$,
  'the owner reads the running review run');
select throws_ok(
  $$update public.problem_runs set status = 'done'$$,
  '42501', null, 'a Student cannot write the run');
select is(public.release_problem_run('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'a run whose workflow did not start is released');
select is(public.queue_problem_run('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'a released run lets the next one start');
reset role;

update public.problem_runs set started_at = now() - interval '2 hours';
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_problem_run('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'a run older than an hour no longer blocks the Course');
reset role;

select * from finish();
rollback;
