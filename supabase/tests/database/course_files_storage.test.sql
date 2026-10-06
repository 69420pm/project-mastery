-- Row Level Security tests for the course-files Storage bucket. Run with
-- `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'course-files'$$,
  $$values (false, 52428800::bigint, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])$$,
  'course-files is a private bucket limited to 50 MB PDFs and images'
);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- One file per user, written as the owner role (bypasses RLS).
insert into storage.objects (bucket_id, name)
values
  ('course-files', '11111111-1111-1111-1111-111111111111/analysis/script.pdf'),
  ('course-files', '22222222-2222-2222-2222-222222222222/algebra/script.pdf');

-- Anonymous visitors see nothing.
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select is_empty(
  $$select id from storage.objects where bucket_id = 'course-files'$$,
  'anon cannot list course files'
);

-- Alice works in her own folder only.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$select name from storage.objects where bucket_id = 'course-files'$$,
  $$values ('11111111-1111-1111-1111-111111111111/analysis/script.pdf')$$,
  'a user only sees files in their own folder'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('course-files', '11111111-1111-1111-1111-111111111111/analysis/page-1.png')$$,
  'a user can upload into their own folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('course-files', '22222222-2222-2222-2222-222222222222/analysis/page-1.png')$$,
  '42501',
  null,
  'a user cannot upload into another user''s folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('course-files', 'shared/page-1.png')$$,
  '42501',
  null,
  'a user cannot upload outside a user folder'
);

select lives_ok(
  $$update storage.objects set metadata = '{"pages": 12}' where name = '11111111-1111-1111-1111-111111111111/analysis/script.pdf'$$,
  'a user can update their own files'
);

-- RLS hides Bob's file, so these statements match no rows. The effect is
-- checked below as the owner role.
select lives_ok(
  $$update storage.objects set metadata = '{"pages": 0}' where name = '22222222-2222-2222-2222-222222222222/algebra/script.pdf'$$,
  'updating another user''s file does not raise'
);

select throws_ok(
  $$update storage.objects set name = '22222222-2222-2222-2222-222222222222/analysis/script.pdf' where name = '11111111-1111-1111-1111-111111111111/analysis/script.pdf'$$,
  '42501',
  null,
  'a user cannot move their file into another user''s folder'
);

-- Storage blocks direct deletes unless this setting is on; the API sets it.
set local storage.allow_delete_query = 'true';

select lives_ok(
  $$delete from storage.objects where name = '22222222-2222-2222-2222-222222222222/algebra/script.pdf'$$,
  'deleting another user''s file does not raise'
);

-- Back to the owner role to check the effect of Alice's attempts.
reset role;

select is(
  (select metadata from storage.objects where name = '22222222-2222-2222-2222-222222222222/algebra/script.pdf'),
  null,
  'a user cannot update another user''s files'
);

select is(
  (select count(*)::int from storage.objects where name = '22222222-2222-2222-2222-222222222222/algebra/script.pdf'),
  1,
  'a user cannot delete another user''s files'
);

select * from finish();
rollback;
