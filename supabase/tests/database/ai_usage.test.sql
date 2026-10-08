-- Row Level Security tests for public.ai_usage, the record of every AI call
-- per Student. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- Two Students. The signup trigger creates their profiles.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.chats (id, owner)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

insert into public.ai_usage (id, owner, task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, chat_id)
values
  ('aaaaaaaa-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'chat', 'google/gemini-2.5-flash', 100, 0, 50, 0.000155, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'chat', 'google/gemini-2.5-flash', 100, 0, 50, 0.000155, 'bbbbbbbb-0000-0000-0000-000000000001');

select policies_are(
  'public',
  'ai_usage',
  array[
    'Students can read their own AI usage',
    'Students can record their own AI usage'
  ],
  'ai_usage has exactly the expected policies'
);

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.ai_usage', '42501', null, 'anon has no access to AI usage');

-- Alice reads and records only her own usage.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select id from public.ai_usage',
  $$values ('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid)$$,
  'a Student only sees their own usage records'
);

select lives_ok(
  $$insert into public.ai_usage (task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, estimated, chat_id)
    values ('chat', 'google/gemini-2.5-flash', 10, 0, 20, 0.00005, true, 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'a Student can record usage, owned by them by default'
);

select lives_ok(
  $$insert into public.ai_usage (task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd)
    values ('title', 'google/gemini-2.5-flash-lite', 10, 0, 5, 0.000003)$$,
  'a Student can record usage without a Chat'
);

select throws_ok(
  $$insert into public.ai_usage (owner, task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd)
    values ('22222222-2222-2222-2222-222222222222', 'chat', 'google/gemini-2.5-flash', 1, 0, 1, 0.000001)$$,
  '42501',
  null,
  'a Student cannot record usage for another Student'
);

select throws_ok(
  $$insert into public.ai_usage (task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, chat_id)
    values ('chat', 'google/gemini-2.5-flash', 1, 0, 1, 0.000001, 'bbbbbbbb-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a Student cannot record usage on another Student''s Chat'
);

select throws_ok(
  $$insert into public.ai_usage (task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, created_at)
    values ('chat', 'google/gemini-2.5-flash', 1, 0, 1, 0.000001, now() - interval '1 day')$$,
  '42501',
  null,
  'a Student cannot backdate usage out of today''s spend'
);

select throws_ok(
  $$insert into public.ai_usage (task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd)
    values ('chat', 'google/gemini-2.5-flash', 1, 0, 1, -1)$$,
  '23514',
  null,
  'a Student cannot record a negative cost'
);

select throws_ok(
  $$update public.ai_usage set cost_usd = 0$$,
  '42501',
  null,
  'a Student cannot change their usage records'
);

select throws_ok(
  $$delete from public.ai_usage$$,
  '42501',
  null,
  'a Student cannot delete their usage records'
);

reset role;

select is(
  (select count(*)::int from public.ai_usage where owner = '11111111-1111-1111-1111-111111111111'),
  3,
  'Alice''s records are all still there'
);

select is(
  (select estimated from public.ai_usage where owner = '11111111-1111-1111-1111-111111111111' and task = 'title'),
  false,
  'a recorded cost is exact unless marked as estimated'
);

-- Deleting a Chat keeps its usage, without the Chat reference.
delete from public.chats where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.ai_usage where owner = '11111111-1111-1111-1111-111111111111'),
  3,
  'usage records survive the deletion of their Chat'
);

select is(
  (select count(*)::int from public.ai_usage where owner = '11111111-1111-1111-1111-111111111111' and chat_id is not null),
  0,
  'usage records lose the reference to a deleted Chat'
);

-- Deleting the account removes the usage records.
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::int from public.ai_usage where owner = '11111111-1111-1111-1111-111111111111'),
  0,
  'usage records are deleted with the account'
);

select is(
  (select count(*)::int from public.ai_usage where owner = '22222222-2222-2222-2222-222222222222'),
  1,
  'other Students'' usage records stay'
);

select * from finish();
rollback;
