-- Schema-wide guards for every table in `public`, so a new table cannot skip
-- them: Row Level Security is on, and visitors (anon) hold no privileges.
-- Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select cmp_ok(
  (select count(*)::int from pg_catalog.pg_class
    where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')),
  '>', 0, 'the public schema has tables to check');

select is_empty(
  $$select c.relname from pg_catalog.pg_class as c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity$$,
  'every public table has Row Level Security enabled');

select is_empty(
  $$select c.relname || ': ' || p.privilege_type
    from pg_catalog.pg_class as c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as p
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and p.grantee = 'anon'::regrole$$,
  'anon has no privileges on any public table');

select * from finish();
rollback;
