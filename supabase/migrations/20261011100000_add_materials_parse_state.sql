-- Parse state of a Material (#54): the parse workflow turns its pages into
-- chunks and reports its progress here, where the Materials page reads it.
-- Only the workflow (service role) writes these columns.

alter table public.materials
  -- not_parsed: uploaded before parsing existed; queued: waiting for the
  -- workflow; parsing: pages in progress; parsed: chunks stored; failed: see
  -- parse_failure.
  add column parse_status text not null default 'not_parsed' check (
    parse_status in ('not_parsed', 'queued', 'parsing', 'parsed', 'failed')
  ),
  -- Known once the workflow has opened the file; an image has one page.
  add column pages_total integer check (pages_total >= 1),
  -- How many pages have a stored page result.
  add column pages_done integer not null default 0 check (
    pages_done >= 0 and (pages_total is null or pages_done <= pages_total)
  ),
  -- A short message for the Student when the parse failed.
  add column parse_failure text check (char_length(parse_failure) between 1 and 300),
  -- Exam metadata the parse finds, null when unknown.
  add column is_exam boolean,
  add column exam_year integer check (exam_year between 1900 and 2200),
  add column exam_total_points numeric check (exam_total_points >= 0);

-- Existing rows got `not_parsed` above; new uploads wait for their workflow.
alter table public.materials alter column parse_status set default 'queued';

comment on column public.materials.parse_status is 'not_parsed, queued, parsing, parsed or failed. Written by the parse workflow only.';

-- A Student inserts only the upload's columns, so a new Material always
-- starts `queued`, and updates only its name (granted before).
revoke insert on table public.materials from authenticated;
grant insert (id, owner, course_id, name, media_type, size_bytes, storage_path)
  on table public.materials to authenticated;
