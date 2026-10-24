-- Topic choices (#177): a Student pins or skips Topics of their own Courses,
-- changes the choice by upserting, and cannot read or write another
-- Student's. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.courses (id, owner, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jet engines');

insert into public.big_ideas (id, owner, course_id, name, description, position)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'Thrust', 'Momentum makes thrust.', 0);

insert into public.topics (id, owner, course_id, big_idea_id, name, central_question, why_it_matters, position)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'Thrust', 'Where does thrust come from?', '.', 0);

-- Alice skips her Topic, then pins it instead.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select lives_ok(
  $$insert into public.topic_choices (topic_id, choice) values ('dddddddd-0000-0000-0000-000000000001', 'skipped')$$,
  'a Student skips a Topic of their own Course');
select lives_ok(
  $$insert into public.topic_choices (topic_id, choice, created_at)
    values ('dddddddd-0000-0000-0000-000000000001', 'pinned', now())
    on conflict (owner, topic_id) do update set choice = excluded.choice, created_at = excluded.created_at$$,
  'choosing the other one replaces it');
select results_eq(
  $$select choice from public.topic_choices$$,
  $$values ('pinned')$$,
  'one choice per Topic');
select throws_ok(
  $$insert into public.topic_choices (topic_id, choice) values ('dddddddd-0000-0000-0000-000000000001', 'later')$$,
  '23514', null, 'a choice is pinned or skipped');

-- Bob sees nothing and cannot choose on Alice's Topic.
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select count(*)::int from public.topic_choices), 0, 'another Student reads none');
select throws_ok(
  $$insert into public.topic_choices (topic_id, choice) values ('dddddddd-0000-0000-0000-000000000001', 'skipped')$$,
  '42501', null, 'another Student cannot choose on the Topic');

select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
delete from public.topic_choices;
select is((select count(*)::int from public.topic_choices), 0, 'a Student removes their choice');

select * from finish();
rollback;
