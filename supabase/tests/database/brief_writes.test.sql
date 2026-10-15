-- Tests for public.save_brief and public.add_brief_note, the writes of the
-- Brief's tools. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

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
  ('aaaaaaaa-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001', 'Lecture', '11111111-1111-1111-1111-111111111111/aaaaaaaa-c000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000000f2', 'application/pdf', 10),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-c000-0000-0000-000000000001', 'Notes', '22222222-2222-2222-2222-222222222222/bbbbbbbb-c000-0000-0000-000000000001/bbbbbbbb-0000-0000-0000-0000000000f1', 'application/pdf', 10);

insert into public.briefs (course_id, owner)
values
  ('aaaaaaaa-c000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-c000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select ok(
  public.save_brief(
    'aaaaaaaa-c000-0000-0000-000000000001',
    '{"exam_date": "2026-12-03", "hours_per_week": 6, "calculator": true, "scope_confirmed": true}',
    array['aaaaaaaa-0000-0000-0000-0000000000f1']::uuid[]
  ),
  'save_brief saves the given fields'
);

select results_eq(
  $$select exam_date, hours_per_week, calculator, scope_confirmed, goal from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  $$values ('2026-12-03'::date, 6::numeric, true, true, null::text)$$,
  'only the given fields change'
);

select ok(
  public.save_brief('aaaaaaaa-c000-0000-0000-000000000001', '{"goal": "pass"}'),
  'save_brief without excluded Materials keeps the set'
);

select results_eq(
  $$select material_id from public.brief_excluded_materials$$,
  $$values ('aaaaaaaa-0000-0000-0000-0000000000f1'::uuid)$$,
  'the excluded set is kept'
);

select throws_ok(
  $$select public.save_brief('aaaaaaaa-c000-0000-0000-000000000001', '{"hours_per_week": 7}', array['aaaaaaaa-0000-0000-0000-0000000000f2', 'bbbbbbbb-0000-0000-0000-0000000000f1']::uuid[])$$,
  '42501',
  null,
  'save_brief refuses another Student''s Material'
);

select results_eq(
  $$select b.hours_per_week, (select array_agg(material_id) from public.brief_excluded_materials) from public.briefs b where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'$$,
  $$values (6::numeric, array['aaaaaaaa-0000-0000-0000-0000000000f1']::uuid[])$$,
  'a failed save_brief changes nothing'
);

select is(
  public.save_brief('bbbbbbbb-c000-0000-0000-000000000001', '{"goal": "pass"}'),
  false,
  'save_brief does not see another Student''s Brief'
);

select public.add_brief_note('aaaaaaaa-c000-0000-0000-000000000001', 'First.');
select public.add_brief_note('aaaaaaaa-c000-0000-0000-000000000001', 'Second.');

select is(
  (select notes from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'),
  E'First.\n\nSecond.',
  'add_brief_note appends after a blank line'
);

select isnt(
  (select notes_updated_at from public.briefs where course_id = 'aaaaaaaa-c000-0000-0000-000000000001'),
  null,
  'add_brief_note sets notes_updated_at'
);

select is(
  public.add_brief_note('aaaaaaaa-c000-0000-0000-000000000001', repeat('x', 20000)),
  false,
  'add_brief_note refuses notes past the limit'
);

select * from finish();
rollback;
