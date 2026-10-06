-- Row Level Security tests for public.profiles. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Two users. The signup trigger creates their profiles.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"display_name": "  Alice  "}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com', '{}');

select is(
  (select count(*)::int from public.profiles),
  2,
  'signup trigger creates one profile per user'
);

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Alice',
  'signup trigger copies the trimmed display name from user metadata'
);

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'display name is null when signup metadata has none'
);

select policies_are(
  'public',
  'profiles',
  array['Users can read their own profile', 'Users can update their own profile'],
  'profiles has exactly the expected policies'
);

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok(
  'select * from public.profiles',
  '42501',
  null,
  'anon has no access to profiles'
);

-- Alice sees and edits only her own profile.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select id from public.profiles',
  $$values ('11111111-1111-1111-1111-111111111111'::uuid)$$,
  'a user only sees their own profile'
);

select lives_ok(
  $$update public.profiles set display_name = 'Alice A.' where id = '11111111-1111-1111-1111-111111111111'$$,
  'a user can update their own display name'
);

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Alice A.',
  'the update is applied'
);

-- RLS filters the other user's row out, so this updates nothing. The effect
-- is checked below as the owner role.
select lives_ok(
  $$update public.profiles set display_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222'$$,
  'updating another user''s profile does not raise'
);

select throws_ok(
  $$update public.profiles set created_at = now() where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'a user cannot change columns other than the display name'
);

select throws_ok(
  $$insert into public.profiles (id) values ('33333333-3333-3333-3333-333333333333')$$,
  '42501',
  null,
  'a user cannot insert profiles'
);

select throws_ok(
  $$delete from public.profiles where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'a user cannot delete profiles'
);

-- Back to the owner role to check the effect of Alice's attempts.
reset role;

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'a user cannot update another user''s profile'
);

select * from finish();
rollback;
