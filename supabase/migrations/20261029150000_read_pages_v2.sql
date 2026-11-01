-- Page call v2 (#223, slice 6 of #222): skipped and unreadable pages, the
-- page and Material language, the parse lease and four chunk labels. The
-- file call is gone, so replace_material_chunks no longer stores exam
-- metadata: only the Brief sets `materials.is_exam`.

-- Why a page has no units, or null for a page the page call read.
alter table public.material_pages
  add column skipped text check (skipped in ('blank', 'overlay', 'unreadable')),
  add column language text check (char_length(language) between 2 and 35),
  add constraint material_pages_skipped_has_no_units
    check (skipped is null or units = '[]'::jsonb);

comment on column public.material_pages.skipped is 'Why the page was not read: blank (almost all white), overlay (a slide build-up the next page repeats) or unreadable (its page call failed after its retries). Null for a read page.';
comment on column public.material_pages.language is 'The page''s language as its page call gave it (BCP 47); null for a skipped page.';

-- Pages stored by the old page call, of a parse that has not finished, are
-- read again by the new one.
delete from public.material_pages as p
using public.materials as m
where m.id = p.material_id and m.parse_status <> 'parsed';

alter table public.materials
  add column language text check (char_length(language) between 2 and 35),
  add column heartbeat_at timestamptz not null default now();

comment on column public.materials.language is 'The most common language of the Material''s read pages (BCP 47), set when its parse ends.';
comment on column public.materials.heartbeat_at is 'When a parse step or queue_material_parse last touched the Material. A queued or parsing Material untouched for 30 minutes counts as failed.';

-- Four chunk labels: definitions, examples and figures are content.
update public.chunks set label = 'content'
where label in ('definition', 'example', 'figure');
alter table public.chunks drop constraint chunks_label_check;
alter table public.chunks add constraint chunks_label_check
  check (label in ('content', 'exercise', 'solution', 'admin'));

-- The parse workflow's write of a Material's chunks: in one transaction, it
-- replaces any earlier chunks of the Material. A failed write keeps them.
--
-- p_chunks is a jsonb array of objects with the chunk columns position,
-- page_from, page_to, label, markdown and exercise_number. Owner and Course
-- come from the Material. Runs as its caller: only the service role may
-- call it.
drop function public.replace_material_chunks(uuid, jsonb, boolean, integer, numeric);

create function public.replace_material_chunks(p_material_id uuid, p_chunks jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_course_id uuid;
begin
  select owner, course_id into v_owner, v_course_id
  from public.materials
  where id = p_material_id
  for update;
  if not found then
    return;
  end if;

  delete from public.chunks where material_id = p_material_id;

  insert into public.chunks (
    owner, course_id, material_id, position, page_from, page_to, label,
    markdown, exercise_number
  )
  select
    v_owner, v_course_id, p_material_id, c.position, c.page_from, c.page_to,
    c.label, c.markdown, c.exercise_number
  from jsonb_to_recordset(p_chunks) as c (
    position integer, page_from integer, page_to integer, label text,
    markdown text, exercise_number text
  );
end;
$$;

comment on function public.replace_material_chunks(uuid, jsonb) is
  'Replaces a Material''s chunks in one transaction. Parse workflow (service role) only.';

revoke execute on function public.replace_material_chunks(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_material_chunks(uuid, jsonb)
  to service_role;

-- The lease: as queue_material_parse before, and a queued or parsing
-- Material whose heartbeat is older than 30 minutes counts as failed, so it
-- is queued again. Queueing sets the heartbeat.
create or replace function public.queue_material_parse(material_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with queued as (
    update public.materials
    set
      parse_status = 'queued',
      parse_failure = null,
      parse_start_failed = false,
      heartbeat_at = now()
    where id = queue_material_parse.material_id
      and owner = (select auth.uid())
      and (
        parse_status in ('not_parsed', 'failed')
        or (parse_status = 'queued' and parse_start_failed)
        or (
          parse_status in ('queued', 'parsing')
          and heartbeat_at < now() - interval '30 minutes'
        )
      )
    returning id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_material_parse(uuid) is 'Queues a parse of the caller''s Material if it is not_parsed, failed, queued without a started workflow, or queued or parsing without a heartbeat for 30 minutes; true when it did.';

-- As before, but a queued or parsing Material without a heartbeat for 30
-- minutes does not hold the build back: it is marked failed.
create or replace function public.queue_knowledge_map_build(course_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with stopped as (
    update public.materials as m
    set parse_status = 'failed', parse_failure = 'The parse stopped. Parse again.'
    where m.course_id = queue_knowledge_map_build.course_id
      and m.owner = (select auth.uid())
      and m.parse_status in ('queued', 'parsing')
      and m.heartbeat_at < now() - interval '30 minutes'
    returning m.id
  ),
  course as (
    select c.id, c.owner
    from public.courses as c
    where c.id = queue_knowledge_map_build.course_id
      and c.owner = (select auth.uid())
      and exists (
        select 1 from public.materials as m
        where m.course_id = c.id and m.parse_status = 'parsed'
      )
      and not exists (
        select 1 from public.materials as m
        where m.course_id = c.id
          and m.parse_status in ('queued', 'parsing')
          and m.id not in (select id from stopped)
      )
  ),
  queued as (
    insert into public.knowledge_map_builds as b (course_id, owner, status)
    select id, owner, 'building' from course
    on conflict (course_id) do update
    set status = 'building', failure_reason = null, started_at = now()
    where b.status <> 'building'
    returning b.course_id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_knowledge_map_build(uuid) is 'Starts a Knowledge map build of the caller''s Course if none is running, a Material is parsed and none is queued or parsing; a queued or parsing Material without a heartbeat for 30 minutes is marked failed first. True when it started one.';
