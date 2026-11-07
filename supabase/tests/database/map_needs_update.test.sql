-- The map needs Update map (#249) once a Material finished parsing or was
-- deleted, or the Student confirmed or withdrew an old exam, since its build
-- began. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');
insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra');
insert into public.knowledge_map_builds (course_id, owner, status, finished_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'built', now());
insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
    'parsed'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Notes', 'application/pdf', 1000,
    '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000002',
    'parsing');
select public.replace_material_chunks('aaaaaaaa-1111-0000-0000-000000000001',
  '[{"position": 0, "parent_position": null, "depth": 0, "title": "Script", "page_from": 1},
    {"position": 1, "parent_position": 0, "depth": 1, "title": "Final exam", "page_from": 2}]',
  '[{"position": 0, "page_from": 2, "page_to": 2, "label": "exercise", "markdown": "Find a basis.", "chapter_position": 1}]');

create function pg_temp.needs_update() returns boolean language sql as $$
  select needs_update from public.knowledge_map_builds
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$;
create function pg_temp.clear() returns void language sql as $$
  update public.knowledge_map_builds set needs_update = false
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$;

select pg_temp.clear();
select is(pg_temp.needs_update(), false, 'a built map needs no update');

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
update public.chapters set is_exam = true where title = 'Final exam';
reset role;
select is(pg_temp.needs_update(), true, 'the Student confirming an old exam marks it');

select pg_temp.clear();
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
update public.chapters set is_exam = true where title = 'Final exam';
reset role;
select is(pg_temp.needs_update(), false, 'answering the same again does not');

update public.materials set parse_status = 'parsed' where name = 'Notes';
select is(pg_temp.needs_update(), true, 'a Material that finished parsing marks it');

select pg_temp.clear();
delete from public.materials where name = 'Notes';
select is(pg_temp.needs_update(), true, 'a deleted Material marks it');

select * from finish();
rollback;
