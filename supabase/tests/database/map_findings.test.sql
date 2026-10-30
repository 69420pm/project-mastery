-- Map Findings (#181, #224): a Student files open Findings in their own
-- session on KCs and a chunk of its Course, reads only their own, and answers
-- an open one once: dismissing it, or accepting it through
-- `accept_map_finding`, which applies the change and marks it applied, and
-- refuses a link that would close a cycle. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Biology');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values
  ('9b9b9b9b-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', 'Propulsion', 'How engines push.', 0),
  ('9b9b9b9b-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', 'Life', 'What lives.', 0);

insert into public.kcs (id, owner, course_id, big_idea_id, name, description, type, origin, position)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', '9b9b9b9b-0000-0000-0000-000000000001',
    'Momentum', 'p = mv.', 'fact', 'content', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001', '9b9b9b9b-0000-0000-0000-000000000001',
    'Thrust', 'F = ṁ Δv.', 'fact', 'content', 1),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000002', '9b9b9b9b-0000-0000-0000-000000000002',
    'Cells', 'Units of life.', 'fact', 'content', 0);

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
  p_kc uuid default 'bbbbbbbb-0000-0000-0000-000000000002',
  p_quote text default 'change in momentum',
  p_proposed text default null
) returns uuid language sql as $$
  insert into public.map_findings
    (course_id, study_session_id, kind, kc_id, linked_kc_id, proposed_description, chunk_id, quote, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
    (select id from ids where chat_id = p_chat), p_kind, p_kc, p_linked, p_proposed,
    'cccccccc-0000-0000-0000-000000000001', p_quote, 'Thrust needs momentum.')
  returning id
$$;
grant execute on function pg_temp.file(text, uuid, uuid, uuid, text, text) to authenticated;

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
select throws_ok($$select pg_temp.file(p_quote => E'  \n ')$$,
  '23514', null, 'a quote shows more than whitespace');
select throws_ok($$select pg_temp.file(p_kind => 'wrong_description', p_linked => null)$$,
  '23514', null, 'a description Finding needs its proposed description');
select throws_ok($$select pg_temp.file(p_proposed => 'New.')$$,
  '23514', null, 'a link Finding has no proposed description');

-- The Student dismisses the open Finding once; it cannot be set to accepted
-- or applied directly.
select throws_ok($$
  update public.map_findings set status = 'applied', outcome = 'Done.'
  where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '42501', null, 'the Student cannot mark one applied');
update public.map_findings set status = 'dismissed'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select status from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'dismissed', 'the Student dismisses an open Finding');
update public.map_findings set status = 'open'
where course_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select status from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'dismissed', 'a dismissed Finding stays dismissed');

-- missing_link: Thrust builds on Momentum; accepting adds the link.
create temporary table found (name text primary key, id uuid) on commit drop;
grant all on found to authenticated;
insert into found values
  ('add', pg_temp.file()),
  ('cycle', pg_temp.file(p_kc => 'bbbbbbbb-0000-0000-0000-000000000001',
    p_linked => 'bbbbbbbb-0000-0000-0000-000000000002')),
  ('remove', pg_temp.file(p_kind => 'wrong_link')),
  ('describe', pg_temp.file(p_kind => 'wrong_description', p_linked => null,
    p_proposed => 'Thrust is the force from the change in momentum.'));

select is(public.accept_map_finding((select id from found where name = 'add')), null::text,
  'accepting a missing link applies it');
select results_eq(
  $$select from_kc, to_kc from public.prerequisite_links$$,
  $$values ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid)$$,
  'the Prerequisite runs from the linked KC to the KC');
select results_eq(
  $$select status, outcome from public.map_findings where id = (select id from found where name = 'add')$$,
  $$values ('applied'::text, 'Added the prerequisite.'::text)$$,
  'the Finding is applied with its outcome');

select is(public.accept_map_finding((select id from found where name = 'cycle')),
  'This link would make a cycle.', 'a link that would close a cycle is refused');
select results_eq(
  $$select status, (select count(*)::int from public.prerequisite_links) from public.map_findings where id = (select id from found where name = 'cycle')$$,
  $$values ('open'::text, 1)$$,
  'the refused Finding stays open and adds nothing');

-- wrong_link removes the link whichever way it runs.
select is(public.accept_map_finding((select id from found where name = 'remove')), null::text,
  'accepting a wrong link applies it');
select is((select count(*)::int from public.prerequisite_links), 0, 'the link is gone');

select is(public.accept_map_finding((select id from found where name = 'describe')), null::text,
  'accepting a wrong description applies it');
select is(
  (select description from public.kcs where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'Thrust is the force from the change in momentum.', 'the KC has the proposed description');
select is(public.accept_map_finding((select id from found where name = 'describe')),
  'This Finding was not found.', 'an applied Finding cannot be accepted again');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*)::int from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'another Student reads none of them');
select is(public.accept_map_finding((select id from found where name = 'cycle')),
  'This Finding was not found.', 'nor accepts one');
reset role;

-- Deleting the chunk takes them all along.
delete from public.chunks where id = 'cccccccc-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.map_findings where course_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'a deleted chunk takes its Findings along');

select * from finish();
rollback;
