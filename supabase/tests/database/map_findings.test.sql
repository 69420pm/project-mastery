-- Map Findings (#181): a Student files open Findings in their own session on
-- KCs and a chunk of its Course, reads only their own, and answers an open
-- one once, as accepted or dismissed. Only the service role marks one
-- applied. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Biology');

insert into public.kcs (id, owner, course_id, name, description, type, bloom, origin, position)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Momentum', 'p = mv.', 'prior', null, 'prior', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'F = ṁ Δv.', 'prior', null, 'prior', 1),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'Cells', 'Units of life.', 'prior', null, 'prior', 0);

insert into public.materials (id, owner, course_id, name, media_type, size_bytes, storage_path, parse_status)
values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Script', 'application/pdf', 1000,
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-1111-0000-0000-000000000001', 'parsing');

insert into public.chunks (id, owner, course_id, material_id, position, page_from, page_to, label, markdown)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 0, 3, 3, 'content',
  'Thrust follows from the change in momentum.');

insert into public.chats (id, owner, course_id)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001');

create temporary table ids on commit drop as
select chat_id, id from public.study_sessions
where chat_id in ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002');
grant select on ids to authenticated;

-- A Finding as Alice files it in her session, with some columns replaced.
create function pg_temp.file(
  p_kind text default 'missing_link',
  p_linked uuid default 'bbbbbbbb-0000-0000-0000-000000000001',
  p_chat uuid default 'dddddddd-0000-0000-0000-000000000001',
  p_kc uuid default 'bbbbbbbb-0000-0000-0000-000000000002'
) returns uuid language sql as $$
  insert into public.map_findings
    (course_id, study_session_id, kind, kc_id, linked_kc_id, chunk_id, quote, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
    (select id from ids where chat_id = p_chat), p_kind, p_kc, p_linked,
    'cccccccc-0000-0000-0000-000000000001', 'change in momentum', 'Thrust needs momentum.')
  returning id
$$;
grant execute on function pg_temp.file(text, uuid, uuid, uuid) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok($$select pg_temp.file()$$, 'a Student files a Finding in their own session');
select results_eq(
  $$select owner, status from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values ('11111111-1111-1111-1111-111111111111'::uuid, 'open'::text)$$,
  'it is theirs and open');
select throws_ok($$select pg_temp.file(p_chat => 'dddddddd-0000-0000-0000-000000000002')$$,
  '42501', null, 'not in another Student''s session');
select throws_ok($$select pg_temp.file(p_kc => 'bbbbbbbb-0000-0000-0000-000000000003')$$,
  '42501', null, 'not on a KC of another Course');
select throws_ok($$select pg_temp.file(p_kind => 'wrong_description')$$,
  '23514', null, 'a description Finding has no linked KC');
select throws_ok($$select pg_temp.file(p_linked => null)$$,
  '23514', null, 'a link Finding needs its linked KC');

select lives_ok($$
  update public.map_findings set status = 'accepted'
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, 'the Student accepts an open Finding');
update public.map_findings set status = 'dismissed'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select status from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'accepted', 'an answered Finding stays as answered');

select pg_temp.file();
select throws_ok($$
  update public.map_findings set status = 'applied'
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and status = 'open'
$$, '42501', null, 'the Student cannot mark one applied');
select throws_ok($$
  update public.map_findings set outcome = 'Done.'
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '42501', null, 'nor write its outcome');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'another Student reads none of them');
reset role;

-- The build applies one; deleting its chunk takes them all along.
update public.map_findings set status = 'applied', outcome = 'Added the prerequisite.'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001' and status = 'accepted';
delete from public.chunks where id = 'cccccccc-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'a deleted chunk takes its Findings along');

select * from finish();
rollback;
