-- Reading sections (#178): owners read their own and write none; a
-- section's mode and its text go together. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Chapter 7', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsed');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'Thrust', 'Where does thrust come from?', 0);

insert into public.reading_sections (owner, course_id, topic_id, material_id, position,
    page_from, page_to, chunk_ids, mode, reason)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 0,
  1, 2, '{cccccccc-0000-0000-0000-000000000001}', 'original', 'Clear.');

-- Students read their own sections and write none.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is((select count(*)::int from public.reading_sections), 0,
  'another Student reads no sections');
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is((select count(*)::int from public.reading_sections), 1,
  'the owner reads their sections');
select throws_ok(
  $$delete from public.reading_sections$$,
  '42501', null, 'a Student cannot change sections');
reset role;

-- The mode and its text go together.
select throws_ok(
  $$insert into public.reading_sections (owner, course_id, topic_id, material_id, position,
      page_from, page_to, chunk_ids, mode, reason)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 5,
      1, 1, '{cccccccc-0000-0000-0000-000000000001}', 'annotated', 'Gaps.')$$,
  '23514', null, 'an annotated section needs its notes');

select * from finish();
rollback;
