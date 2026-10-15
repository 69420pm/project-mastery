-- The KC priority tables and functions (#86): a Student starts a run only
-- for a built map, one at a time and only when it is stale, only the
-- workflow writes priorities, and owners read their own rows. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.kcs (id, owner, course_id, name, description, type, bloom, origin, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Newton''s laws', 'Force pairs.', 'prior', null, 'prior', 0);

-- No built map: no run.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'no run before the map is built');
reset role;
insert into public.knowledge_map_builds (course_id, owner, status, finished_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'built', now() - interval '1 hour');

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'another Student cannot start a run');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'the owner starts the first run');
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'a second call while it runs starts nothing');
select throws_ok(
  $$select public.replace_kc_priorities('aaaaaaaa-0000-0000-0000-000000000001', '[]')$$,
  '42501', null, 'a Student cannot write priorities');
reset role;

-- The workflow stores the priorities, skipping an unknown KC.
set local role service_role;
select is(
  public.replace_kc_priorities('aaaaaaaa-0000-0000-0000-000000000001',
    '[{"kcId": "bbbbbbbb-0000-0000-0000-000000000001", "priority": 0.5, "multiplier": 1,
        "reasons": ["Tested by 2 Exercises", "1 KC builds on it"]},
      {"kcId": "bbbbbbbb-0000-0000-0000-000000000009", "priority": 1, "multiplier": 1, "reasons": []}]'),
  true, 'the workflow stores the priorities');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select results_eq(
  $$select p.priority, p.multiplier, p.reasons, r.status
    from public.kc_priorities p join public.priority_runs r using (course_id)$$,
  $$values (0.5::numeric, 1::numeric, array['Tested by 2 Exercises', '1 KC builds on it'], 'done')$$,
  'the owner reads the stored priority and the run is done');
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'nothing changed since the run: no new run');
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.kc_priorities), 0,
  'another Student reads no priorities');
reset role;

-- A Finding answered after the run makes it stale.
update public.priority_runs set computed_at = now() - interval '30 minutes';
insert into public.findings (owner, course_id, kind, text, position, status, answer, answered_at)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
  'scope', 'Not exam-relevant?', 0, 'answered', 'Yes', now() - interval '10 minutes');
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'an answer after the run starts a new one');

-- A run whose workflow does not start fails and keeps the priorities.
select is(public.record_priority_run_start_failure('aaaaaaaa-0000-0000-0000-000000000001'), true,
  'a failed start is recorded');
select results_eq(
  $$select r.status, r.failure_reason is not null, (select count(*)::int from public.kc_priorities)
    from public.priority_runs r$$,
  $$values ('failed', true, 1)$$,
  'the run failed and the previous priorities stay');
select is(public.queue_priority_run('aaaaaaaa-0000-0000-0000-000000000001'), false,
  'a failed run waits for the next change');
reset role;

-- A run that asked the model stores its adjustment, and one that reused it
-- keeps it.
update public.priority_runs
set status = 'running', failure_reason = null, computed_at = '2026-10-01T00:00:00Z';
set local role service_role;
select public.replace_kc_priorities('aaaaaaaa-0000-0000-0000-000000000001', '[]',
  '[{"id": "bbbbbbbb-0000-0000-0000-000000000001", "multiplier": 2, "reason": "Stressed"}]');
reset role;
update public.priority_runs set status = 'running', computed_at = '2026-10-02T00:00:00Z';
set local role service_role;
select public.replace_kc_priorities('aaaaaaaa-0000-0000-0000-000000000001', '[]');
reset role;
select results_eq(
  $$select status, adjusted_at, adjustments -> 0 ->> 'reason' from public.priority_runs$$,
  $$values ('done', '2026-10-01T00:00:00Z'::timestamptz, 'Stressed')$$,
  'the adjustment and its adjusted_at are stored, and a reusing run keeps them');

select * from finish();
rollback;
