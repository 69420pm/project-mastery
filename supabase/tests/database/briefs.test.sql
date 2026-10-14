-- Row Level Security tests for public.briefs, public.brief_excluded_materials
-- and public.brief_messages. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-c000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra'),
  ('bbbbbbbb-c000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.materials (id, owner, course_id, name, storage_path, media_type, size_bytes)
values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'Old exam', '11111111-1111-1111-1111-111111111111/aaaaaaaa-c000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000000f1', 'application/pdf', 10),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-c000-0000-0000-000000000001', 'Notes', '22222222-2222-2222-2222-222222222222/bbbbbbbb-c000-0000-0000-000000000001/bbbbbbbb-0000-0000-0000-0000000000f1', 'application/pdf', 10);

insert into public.briefs (course_id, owner)
values ('bbbbbbbb-c000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$insert into public.briefs (course_id) values ('aaaaaaaa-c000-0000-0000-000000000001')$$,
  'a Student can create the Brief of their own Course'
);

select throws_ok(
  $$insert into public.briefs (course_id) values ('bbbbbbbb-c000-0000-0000-000000000001')$$,
  null,
  null,
  'a Student cannot create a Brief for another Student''s Course'
);

select results_eq(
  'select course_id from public.briefs',
  $$values ('aaaaaaaa-c000-0000-0000-000000000001'::uuid)$$,
  'a Student only sees their own Brief'
);

select throws_ok(
  $$update public.briefs set hours_per_week = 81 where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  '23514',
  null,
  'weekly hours are at most 80'
);

select lives_ok(
  $$update public.briefs set goal = 'pass', hours_per_week = 6, scope_confirmed = true where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  'a Student can answer fields of their Brief'
);

select throws_ok(
  $$update public.briefs set owner = '22222222-2222-2222-2222-222222222222' where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  '42501',
  null,
  'the owner of a Brief never changes'
);

select lives_ok(
  $$insert into public.brief_messages (course_id, role, parts, model_id) values ('aaaaaaaa-c000-0000-0000-000000000001', 'assistant', '[{"type": "text", "text": "When?"}]', 'static')$$,
  'a Student can store messages in their own Brief'
);

select throws_ok(
  $$insert into public.brief_messages (course_id, role, parts) values ('aaaaaaaa-c000-0000-0000-000000000001', 'assistant', '[]')$$,
  '23514',
  null,
  'an AI message needs its model'
);

select throws_ok(
  $$insert into public.brief_messages (course_id, role, parts) values ('bbbbbbbb-c000-0000-0000-000000000001', 'user', '[]')$$,
  '42501',
  null,
  'a Student cannot add messages to another Student''s Brief'
);

select lives_ok(
  $$insert into public.brief_excluded_materials (course_id, material_id) values ('aaaaaaaa-c000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000f1')$$,
  'a Student can exclude their own Material'
);

select throws_ok(
  $$insert into public.brief_excluded_materials (course_id, material_id) values ('aaaaaaaa-c000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000f1')$$,
  '42501',
  null,
  'a Student cannot exclude another Student''s Material'
);

select lives_ok(
  $$delete from public.brief_excluded_materials where material_id = 'aaaaaaaa-0000-0000-0000-0000000000f1'$$,
  'a Student can include a Material again'
);

reset role;
delete from public.courses where id = 'aaaaaaaa-c000-0000-0000-000000000001';

select is(
  (select count(*) from public.brief_messages where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'),
  0::bigint,
  'deleting the Course deletes its Brief and messages'
);

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.briefs', '42501', null, 'anon has no access to Briefs');

select * from finish();
rollback;
