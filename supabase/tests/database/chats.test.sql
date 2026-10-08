-- Row Level Security tests for public.chats and public.chat_messages. Run
-- with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- Two Students. The signup trigger creates their profiles.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- One Chat each, with a message, created as the owner role.
insert into public.chats (id, owner)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

insert into public.chat_messages (id, chat_id, role, parts)
values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'user', '[{"type": "text", "text": "Hi"}]'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'user', '[{"type": "text", "text": "Hello"}]');

select policies_are(
  'public',
  'chats',
  array[
    'Students can read their own chats',
    'Students can create their own chats',
    'Students can update their own chats',
    'Students can delete their own chats'
  ],
  'chats has exactly the expected policies'
);

select policies_are(
  'public',
  'chat_messages',
  array[
    'Students can read messages of their own chats',
    'Students can add messages to their own chats',
    'Students can delete messages of their own chats'
  ],
  'chat_messages has exactly the expected policies'
);

select is(
  (select model_choice from public.chats where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'balanced',
  'a new Chat starts with the Balanced model choice'
);

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.chats', '42501', null, 'anon has no access to chats');
select throws_ok('select * from public.chat_messages', '42501', null, 'anon has no access to chat messages');

-- Alice reads and writes only her own Chats.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select id from public.chats',
  $$values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'a Student only sees their own Chats'
);

select results_eq(
  'select id from public.chat_messages',
  $$values ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid)$$,
  'a Student only sees messages of their own Chats'
);

select lives_ok(
  $$insert into public.chats (id) values ('aaaaaaaa-0000-0000-0000-000000000002')$$,
  'a Student can create a Chat, owned by them by default'
);

select is(
  (select owner from public.chats where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the new Chat belongs to the Student who created it'
);

select throws_ok(
  $$insert into public.chats (id, owner) values ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'a Student cannot create a Chat for someone else'
);

select lives_ok(
  $$insert into public.chat_messages (chat_id, role, parts, model_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'assistant', '[{"type": "text", "text": "Hey"}]', 'google/gemini-2.5-flash')$$,
  'a Student can add messages to their own Chat'
);

select throws_ok(
  $$insert into public.chat_messages (chat_id, role, parts)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 'user', '[{"type": "text", "text": "Sneaky"}]')$$,
  '42501',
  null,
  'a Student cannot add messages to another Student''s Chat'
);

select throws_ok(
  $$update public.chats set owner = '22222222-2222-2222-2222-222222222222' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a Student cannot hand a Chat to someone else'
);

select lives_ok(
  $$update public.chats set model_choice = 'fast', latest_reply_id = gen_random_uuid() where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'a Student can change their Chat''s model choice and latest reply'
);

select lives_ok(
  $$update public.chats set model_choice = 'fast' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'updating another Student''s Chat does not raise'
);

select throws_ok(
  $$update public.chat_messages set parts = '[]' where id = 'aaaaaaaa-0000-0000-0000-0000000000a1'$$,
  '42501',
  null,
  'stored messages cannot be edited'
);

select lives_ok(
  $$delete from public.chat_messages where chat_id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'deleting another Student''s messages does not raise'
);

select lives_ok(
  $$delete from public.chats where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  'deleting another Student''s Chat does not raise'
);

select lives_ok(
  $$delete from public.chats where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'a Student can delete their own Chat'
);

-- Back to the owner role to check the effects.
reset role;

select is(
  (select model_choice from public.chats where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'balanced',
  'a Student cannot update another Student''s Chat'
);

select is(
  (select count(*)::int from public.chat_messages where chat_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'a Student cannot delete another Student''s Chat or its messages'
);

select is(
  (select count(*)::int from public.chat_messages where chat_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'deleting a Chat deletes its messages'
);

delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::int from public.chats where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'deleting an account deletes its Chats'
);

select * from finish();
rollback;
