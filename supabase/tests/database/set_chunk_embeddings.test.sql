-- public.set_chunk_embeddings: the parse workflow's all-or-nothing write of a
-- batch of chunk embeddings. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Analysis');

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values (
  'aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001',
  'parsing'
);

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 0, 1, 1, 'content', 'One'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 1, 2, 2, 'content', 'Two');

-- The batches, built as the workflow builds them: the text form of each vector.
create temporary table batches (name text primary key, embeddings jsonb) on commit drop;
insert into batches values
  ('good', jsonb_build_array(
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001',
      'embedding', '[' || array_to_string(array_fill(0.25, array[2048]), ',') || ']'),
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000002',
      'embedding', '[' || array_to_string(array_fill(0.5, array[2048]), ',') || ']'))),
  ('one malformed', jsonb_build_array(
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001',
      'embedding', '[' || array_to_string(array_fill(0.75, array[2048]), ',') || ']'),
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000002', 'embedding', '[0.1,oops]')));
grant select on batches to anon, authenticated, service_role;

-- Neither a Student nor a visitor can call it.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$select public.set_chunk_embeddings((select embeddings from batches where name = 'good'))$$,
  '42501', null, 'a Student cannot set chunk embeddings');
reset role;

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok(
  $$select public.set_chunk_embeddings((select embeddings from batches where name = 'good'))$$,
  '42501', null, 'a visitor cannot set chunk embeddings');
reset role;

select is(
  (select count(*)::int from public.chunks where embedding is not null),
  0, 'the refused calls set no vectors');

-- The workflow sets a batch.
set local role service_role;
select lives_ok(
  $$select public.set_chunk_embeddings((select embeddings from batches where name = 'good'))$$,
  'the workflow sets a batch of vectors');
reset role;

select results_eq(
  $$select id, embedding = ('[' || array_to_string(array_fill(case position when 0 then 0.25 else 0.5 end, array[2048]), ',') || ']')::extensions.vector
    from public.chunks where material_id = 'aaaaaaaa-1111-0000-0000-000000000001' order by position$$,
  $$values ('cccccccc-0000-0000-0000-000000000001'::uuid, true), ('cccccccc-0000-0000-0000-000000000002'::uuid, true)$$,
  'each chunk gets its own vector');

-- One malformed vector fails the batch, and none of its vectors is set.
set local role service_role;
select throws_ok(
  $$select public.set_chunk_embeddings((select embeddings from batches where name = 'one malformed'))$$,
  '22P02', null, 'a batch with a malformed vector fails');
reset role;

select is(
  (select embedding from public.chunks where id = 'cccccccc-0000-0000-0000-000000000001'),
  ('[' || array_to_string(array_fill(0.25, array[2048]), ',') || ']')::extensions.vector,
  'the failed batch sets none of its vectors');

select * from finish();
rollback;
