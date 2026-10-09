-- The sidebar lists a Student's Chats by their latest message. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email)
values
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

-- Two Chats from yesterday: an older and a newer one.
insert into public.courses (id, owner, name)
values ('cccccccc-c000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Chemistry');

insert into public.chats (id, owner, course_id, created_at, last_message_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'cccccccc-c000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days'),
  ('cccccccc-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'cccccccc-c000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 day');

select is(
  (select last_message_at from public.chats where id = 'cccccccc-0000-0000-0000-000000000001'),
  now() - interval '2 days',
  'a Chat keeps the time of its latest message'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

-- A Student cannot set the time themselves.
select throws_ok(
  $$update public.chats set last_message_at = now() where id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a Student cannot change last_message_at directly'
);

-- A message in the older Chat moves it to the top.
insert into public.chat_messages (chat_id, role, parts)
values ('cccccccc-0000-0000-0000-000000000001', 'user', '[{"type": "text", "text": "Back again"}]');

select results_eq(
  $$select id from public.chats order by last_message_at desc$$,
  $$values ('cccccccc-0000-0000-0000-000000000001'::uuid), ('cccccccc-0000-0000-0000-000000000002'::uuid)$$,
  'a new message moves its Chat to the top'
);

-- Renaming a Chat does not move it.
update public.chats set title = 'Renamed', title_set_manually = true
where id = 'cccccccc-0000-0000-0000-000000000002';

select results_eq(
  $$select id from public.chats order by last_message_at desc$$,
  $$values ('cccccccc-0000-0000-0000-000000000001'::uuid), ('cccccccc-0000-0000-0000-000000000002'::uuid)$$,
  'renaming a Chat keeps its place'
);

reset role;

select is(
  (select last_message_at from public.chats where id = 'cccccccc-0000-0000-0000-000000000002'),
  now() - interval '1 day',
  'only the Chat with the new message changes'
);

select * from finish();
rollback;
