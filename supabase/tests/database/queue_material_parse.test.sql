-- public.queue_material_parse: the guarded move to `queued` behind the
-- Parse and Retry buttons. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

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
  ('aaaaaaaa-1111-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Just uploaded', 'queued'),
  ('aaaaaaaa-1111-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Never started', 'queued'),
  ('bbbbbbbb-1111-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'Bob''s', 'failed')
) as seed (id, owner, course_id, name, status);

-- A Material whose workflow did not start when it was uploaded, 6 minutes
-- ago. The trigger would set updated_at to now().
alter table public.materials disable trigger materials_set_updated_at;
update public.materials set updated_at = now() - interval '6 minutes'
where id = 'aaaaaaaa-1111-0000-0000-000000000006';
alter table public.materials enable trigger materials_set_updated_at;

-- Anonymous visitors cannot call it.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$select public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000001')$$,
  '42501', null, 'anon cannot queue a parse');

-- Alice, signed in.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

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
  'a Material that waits for its workflow is not queued again');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000006'), true,
  'a Material that waited 5 minutes without starting is queued again');
select is(public.queue_material_parse('aaaaaaaa-1111-0000-0000-000000000006'), false,
  'and only once');
select is(public.queue_material_parse('bbbbbbbb-1111-0000-0000-000000000001'), false,
  'another Student''s Material is not queued');

reset role;
select results_eq(
  $$select parse_status || ':' || coalesce(parse_failure, '-') from public.materials
    where course_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')
    order by id$$,
  array['queued:-', 'queued:-', 'parsing:-', 'parsed:-', 'queued:-', 'queued:-', 'failed:The AI could not read page 7'],
  'only the queued Materials changed, and their failure reason is cleared');

select * from finish();
rollback;
