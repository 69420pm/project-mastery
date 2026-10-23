-- Row Level Security for the usage page (/usage), which reads this month's
-- public.ai_usage with each record's Chat and Course. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values
  ('aaaaaaaa-c000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Algebra'),
  ('bbbbbbbb-c000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Biology');

insert into public.chats (id, owner, course_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-c000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-c000-0000-0000-000000000001');

insert into public.ai_usage (owner, task, model_id, input_tokens, output_tokens, cost_usd, chat_id)
values
  ('11111111-1111-1111-1111-111111111111', 'chat', 'google/gemini-2.5-flash', 100, 50, 0.25, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'ingest', 'google/gemini-2.5-flash', 100, 50, 0.5, null),
  ('22222222-2222-2222-2222-222222222222', 'chat', 'google/gemini-2.5-flash', 100, 50, 2, 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'map', 'google/gemini-2.5-flash', 100, 50, 3, null);

set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  (select sum(cost_usd) from public.ai_usage where created_at >= date_trunc('month', now(), 'UTC')),
  0.75::numeric,
  'a Student''s month sums only their own spend'
);

select results_eq(
  $$select courses.name from public.ai_usage
    join public.chats on chats.id = ai_usage.chat_id
    join public.courses on courses.id = chats.course_id$$,
  $$values ('Algebra'::text)$$,
  'a Student''s spend by Course names only their own Courses'
);

set local request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is(
  (select sum(cost_usd) from public.ai_usage where created_at >= date_trunc('month', now(), 'UTC')),
  5::numeric,
  'another Student sees only their own spend'
);

set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok('select * from public.ai_usage', '42501', null, 'anon sees no spend');

select * from finish();
rollback;
