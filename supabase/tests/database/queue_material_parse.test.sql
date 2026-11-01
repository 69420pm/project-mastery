-- public.queue_material_parse, the guarded move to `queued` behind the
-- Parse and Retry buttons, and public.record_parse_start_failure, which
-- marks a `queued` Material whose workflow could not start. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Linear Algebra'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Thermodynamics');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status, parse_failure)
select
  id::uuid, owner::uuid, course_id::uuid, name, 'application/pdf', 1000, owner || '/' || course_id || '/' || id,
  status, case when status = 'failed' then 'The AI could not read page 7' end
from (values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Old', 'not_parsed'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Broken', 'failed'),
  ('aaaaaaaa-1111-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Running', 'parsing'),
  ('aaaaaaaa-1111-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Done', 'parsed'),
  ('aaaaaaaa-1111-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Waiting long', 'queued'),
  ('aaaaaaaa-1111-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Never started', 'queued'),
  ('bbbbbbbb-1111-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'Bob''s', 'queued')
) as seed (id, owner, course_id, name, status);

-- Parses whose workflow died: no heartbeat for 31 minutes.
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status, heartbeat_at)
select
  id::uuid, '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', name,
  'application/pdf', 1000, '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/' || id,
  status, now() - interval '31 minutes'
from (values
  ('aaaaaaaa-1111-0000-0000-000000000007', 'Stalled parse', 'parsing'),
  ('aaaaaaaa-1111-0000-0000-000000000008', 'Stalled wait', 'queued')
) as seed (id, name, status);

-- Anonymous visitors cannot call them.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$select public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000001')$$,
  '42501', null, 'anon cannot queue a parse');
select throws_ok(
  $$select public.record_parse_start_failure('aaaaaaaa-1111-0000-0000-000000000006')$$,
  '42501', null, 'anon cannot record a failed start');

-- Alice, signed in.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$update public.materials set parse_start_failed = true where id = 'aaaaaaaa-1111-0000-0000-000000000005'$$,
  '42501', null, 'a Student cannot mark a start failed directly');

select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000001'), true,
  'a Material that was never parsed is queued');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000002'), true,
  'a failed Material is queued');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000002'), false,
  'queueing it again does nothing, so a double click starts one parse');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000003'), false,
  'a parsing Material is not queued');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000004'), false,
  'a parsed Material is not queued');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000005'), false,
  'a Material whose workflow started is not queued again while its heartbeat is recent');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000007'), true,
  'a parsing Material without a heartbeat for 30 minutes is queued again');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000008'), true,
  'and so is a queued one');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000007'), false,
  'queueing set its heartbeat, so a second press does nothing');

select is(public.record_parse_start_failure('aaaaaaaa-1111-0000-0000-000000000006'), true,
  'a queued Material whose workflow did not start is marked');
select is(public.record_parse_start_failure('aaaaaaaa-1111-0000-0000-000000000003'), false,
  'a parsing Material is not marked');
select is(public.record_parse_start_failure('bbbbbbbb-1111-0000-0000-000000000001'), false,
  'another Student''s Material is not marked');

select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000006'), true,
  'a Material whose workflow did not start is queued again');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000006'), false,
  'and only once');

reset role;
select results_eq(
  $$select parse_status || ':' || coalesce(parse_failure, '-') || ':' || parse_start_failed from public.materials
    where course_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')
    order by id$$,
  array[
    'queued:-:false', 'queued:-:false', 'parsing:-:false', 'parsed:-:false',
    'queued:-:false', 'queued:-:false', 'queued:-:false', 'queued:-:false',
    'queued:-:false'
  ],
  'queued Materials have no failure reason, and a re-queue clears the failed start');

select * from finish();
rollback;
