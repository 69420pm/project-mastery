-- Old exams teach nothing (#249): `retire_unsourced_kcs` takes the sources in
-- the content chunks of an old exam's subtree from the Course's KCs, and
-- retires the KCs left with none. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');
insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');
insert into public.knowledge_map_builds (course_id, owner, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'building');
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');
select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001',
  '[{"position": 0, "parent_position": null, "depth": 0, "title": "Script", "page_from": 1},
    {"position": 1, "parent_position": 0, "depth": 1, "title": "Bases", "page_from": 1},
    {"position": 2, "parent_position": 0, "depth": 1, "title": "Final exam", "page_from": 2},
    {"position": 3, "parent_position": 2, "depth": 2, "title": "Task 1", "page_from": 2}]',
  '[{"position": 0, "page_from": 1, "page_to": 1, "label": "content", "markdown": "Bases.", "chapter_position": 1},
    {"position": 1, "page_from": 2, "page_to": 2, "label": "content", "markdown": "Exam text.", "chapter_position": 3},
    {"position": 2, "page_from": 2, "page_to": 2, "label": "exercise", "markdown": "Find a basis.", "chapter_position": 3}]');
update public.chapters set is_exam = true where title = 'Final exam';

insert into public.kcs (id, owner, course_id, name, description, origin, position)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Basis', 'A spanning independent family.', 'content', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Exam only', 'Only taught in the exam.', 'content', 1),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Exercise KC', 'Found by an exercise.', 'exercise', 2);
insert into public.kc_sources (kc_id, chunk_id, owner, course_id)
select k.id, c.id, k.owner, k.course_id
from public.kcs as k
join public.chunks as c on (k.name, c.markdown) in (
  ('Basis', 'Bases.'), ('Basis', 'Exam text.'), ('Exam only', 'Exam text.'),
  ('Exercise KC', 'Find a basis.')
);

select is(public.retire_unsourced_kcs('aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'a KC taught only in an old exam retires');
select results_eq(
  $$select k.name, count(s.chunk_id)::int from public.kcs as k
    left join public.kc_sources as s on s.kc_id = k.id
    where k.retired_at is null group by k.name order by k.name$$,
  $$values ('Basis'::text, 1), ('Exercise KC'::text, 1)$$,
  'a KC taught elsewhere keeps its other sources');
select is(
  (select count(*)::int from public.kc_sources as s
    join public.chunks as c on c.id = s.chunk_id where c.markdown = 'Exam text.'),
  0, 'the sources in the exam subtree''s content chunks are gone');
select is(
  (select count(*)::int from public.kc_sources as s
    join public.chunks as c on c.id = s.chunk_id where c.label = 'exercise'),
  1, 'an exercise chunk of the exam keeps its source');

select * from finish();
rollback;
