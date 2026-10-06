-- Private bucket for uploaded course PDFs and the page images rendered from
-- them. 50 MB is the upload limit of the Supabase free plan (ARCHITECTURE.md,
-- decision 2).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-files',
  'course-files',
  false,
  52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are stored under a folder named after the owner's user id:
-- `<user id>/<path>`. Each policy checks the first path segment, so a user can
-- only list, read, upload, replace and delete files in their own folder.
-- Upserts need the select, insert and update policies together.
create policy "Users can read their own course files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can upload their own course files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can update their own course files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can delete their own course files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'course-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
