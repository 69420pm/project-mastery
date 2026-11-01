-- public.replace_material_chunks: the parse workflow's one-transaction write
-- of a Material's Outline and chunks, and Row Level Security of
-- public.chapters. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

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
  $$select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001', '[]', '[]')$$,
  '42501', null, 'a Student cannot replace chunks');
reset role;

set local role service_role;
select lives_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[
      {"position": 0, "parent_position": null, "depth": 0, "title": "Exam 2023", "page_from": 1, "exam_proposed": false},
      {"position": 1, "parent_position": 0, "depth": 1, "title": "1 Limits", "page_from": 1, "exam_proposed": false},
      {"position": 2, "parent_position": 1, "depth": 2, "title": "1.1 Exercises", "page_from": 3, "exam_proposed": true}
    ]',
    '[
      {"position": 0, "page_from": 1, "page_to": 2, "label": "content", "markdown": "A limit ...", "chapter_position": 1},
      {"position": 1, "page_from": 2, "page_to": 2, "label": "admin", "markdown": "Exam in March", "chapter_position": 0},
      {"position": 2, "page_from": 3, "page_to": 3, "label": "exercise", "markdown": "a) Show ...", "chapter_position": 2}
    ]')$$,
  'the workflow replaces the Outline and the chunks');
reset role;

select results_eq(
  $$select c.position, c.page_from, c.page_to, c.label, c.markdown, ch.title, c.owner, c.course_id
    from public.chunks as c
    join public.chapters as ch on ch.id = c.chapter_id
    where c.material_id = 'aaaaaaaa-1111-0000-0000-000000000001' order by c.position$$,
  $$values
    (0, 1, 2, 'content', 'A limit ...', '1 Limits',
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
    (1, 2, 2, 'admin', 'Exam in March', 'Exam 2023',
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
    (2, 3, 3, 'exercise', 'a) Show ...', '1.1 Exercises',
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'the new chunks replace the old one, each in its Chapter, owned like the Material');

select results_eq(
  $$select ch.position, ch.depth, ch.title, parent.title, ch.page_from, ch.exam_proposed, ch.owner, ch.course_id
    from public.chapters as ch
    left join public.chapters as parent on parent.id = ch.parent_id
    where ch.material_id = 'aaaaaaaa-1111-0000-0000-000000000001' order by ch.position$$,
  $$values
    (0, 0, 'Exam 2023', null::text, 1, false,
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
    (1, 1, '1 Limits', 'Exam 2023', 1, false,
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid),
    (2, 2, '1.1 Exercises', '1 Limits', 3, true,
      '11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'the Chapters hang below the root by their parents'' positions');

select is(
  (select is_exam from public.materials where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  true, 'the Brief''s old exam stays an old exam');

-- A bad chunk or Chapter rolls back the whole write: the earlier ones stay.
set local role service_role;
select throws_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[{"position": 0, "parent_position": null, "depth": 0, "title": "Exam 2023", "page_from": 1}]',
    '[{"position": 0, "page_from": 1, "page_to": 1, "label": "gossip", "markdown": "x", "chapter_position": 0}]')$$,
  '23514', null, 'an invalid chunk fails the write');
select throws_ok(
  $$select public.replace_material_chunks(
    'aaaaaaaa-1111-0000-0000-000000000001',
    '[{"position": 0, "parent_position": null, "depth": 0, "title": "Exam 2023", "page_from": 1},
      {"position": 1, "parent_position": 7, "depth": 1, "title": "Lost", "page_from": 1}]',
    '[]')$$,
  '23514', null, 'a Chapter without its parent fails the write');
reset role;

select results_eq(
  $$select (select count(*)::int from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001')
    + (select count(*)::int from public.chapters where material_id = 'aaaaaaaa-1111-0000-0000-000000000001')$$,
  array[6], 'a failed write keeps the earlier Outline and chunks');

-- Row Level Security: the owner reads the Chapters, nobody writes them.
select policies_are('public', 'chapters', array['Students can read their own chapters'],
  'chapters has only the read policy');

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is_empty('select * from public.chapters', 'a Student reads no other Student''s Chapters');

set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$insert into public.chapters (owner, course_id, material_id, position, depth, title, page_from)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-1111-0000-0000-000000000001', 9, 0, 'Forged', 1)$$,
  '42501', null, 'a Student cannot add Chapters');
reset role;

select * from finish();
rollback;
