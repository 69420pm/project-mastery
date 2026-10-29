-- public.replace_material_chunks: the parse workflow's one-transaction write
-- of a Material's chunks. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analysis');

-- An old exam, as the Brief confirmed it.
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status, is_exam)
values (
  'aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Exam 2023', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsing', true
);

-- An earlier parse's chunk.
insert into public.chunks (owner, course_id, material_id, position, page_from, page_to, label, markdown)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-1111-0000-0000-000000000001', 0, 1, 1, 'content', 'Old chunk');

-- Students cannot call it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001', '[]')$$,
  '42501', null, 'a Student cannot replace chunks');
reset role;

set local role service_role;
select lives_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[
      {"position": 0, "page_from": 1, "page_to": 2, "label": "content", "markdown": "A limit ...", "exercise_number": null},
      {"position": 1, "page_from": 3, "page_to": 3, "label": "exercise", "markdown": "a) Show ...", "exercise_number": "7.2a"}
    ]')$$,
  'the workflow replaces the chunks');
reset role;

select results_eq(
  $$select position, page_from, page_to, label, markdown, exercise_number, owner, course_id
    from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001' order by position$$,
  $$values
    (0, 1, 2, 'content', 'A limit ...', null::text,
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
    (1, 3, 3, 'exercise', 'a) Show ...', '7.2a',
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'the new chunks replace the old one, owned like the Material');

select is(
  (select is_exam from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  true, 'the Brief''s old exam stays an old exam');

-- A bad chunk rolls back the whole write: the earlier chunks stay.
set local role service_role;
select throws_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[{"position": 0, "page_from": 1, "page_to": 1, "label": "gossip", "markdown": "x", "exercise_number": null}]')$$,
  '23514', null, 'an invalid chunk fails the write');
reset role;

select is(
  (select count(*)::int from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  2, 'a failed write keeps the earlier chunks');

select * from finish();
rollback;
