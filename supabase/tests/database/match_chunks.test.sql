-- public.match_chunks: the Course's embedded chunks by cosine distance, under
-- the caller's Row Level Security. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analysis'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Algebra');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'application/pdf', 1000, '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001', 'parsing'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'Notes', 'application/pdf', 1000, '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000002/aaaaaaaa-1111-0000-0000-000000000002', 'parsing');

-- Unit vectors along the first, second and third axis; the first course also
-- has a chunk without a vector, and the second a chunk on the first axis.
create function pg_temp.vec(axis int) returns text language sql as $$
  select '[' || array_to_string(array_agg(case when i = axis then 1 else 0 end order by i), ',') || ']'
  from generate_series(1, 2048) as i
$$;

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown, embedding)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 0, 1, 1, 'content', 'Far', pg_temp.vec(3)::extensions.vector),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 1, 2, 2, 'content', 'Near', pg_temp.vec(1)::extensions.vector),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 2, 3, 3, 'content', 'No vector', null),
  ('cccccccc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000002', 0, 1, 1, 'content', 'Other course', pg_temp.vec(1)::extensions.vector);

grant execute on function pg_temp.vec(int) to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$select id from public.match_chunks('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(1), 10)$$,
  $$values ('cccccccc-0000-0000-0000-000000000002'::uuid), ('cccccccc-0000-0000-0000-000000000001'::uuid)$$,
  'the Course''s embedded chunks come nearest first, without other Courses or unembedded chunks');

select is(
  (select distance from public.match_chunks('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(1), 1)),
  0::double precision,
  'the distance is cosine: 0 for the same direction');

select is(
  (select count(*)::int from public.match_chunks('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(1), 1)),
  1, 'the count limits the rows');

reset role;

-- Another Student sees none of Alice's chunks.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.match_chunks('aaaaaaaa-0000-0000-0000-000000000001', pg_temp.vec(1), 10)),
  0, 'another Student matches none of the chunks');
reset role;

-- A visitor cannot call it.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$select * from public.match_chunks('aaaaaaaa-0000-0000-0000-000000000001', '[1]', 10)$$,
  '42501', null, 'a visitor cannot match chunks');
reset role;

select is(
  (select count(*)::int from public.match_chunks('aaaaaaaa-0000-0000-0000-000000000099', pg_temp.vec(1), 10)),
  0, 'a Course without chunks matches none');

select * from finish();
rollback;
