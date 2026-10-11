-- Parse and Retry (#55). Students cannot write the parse columns, so these
-- functions run with their owner's rights and check the owner themselves.

-- Set when starting a Material's workflow failed (the queue was down at
-- upload), so the Material stays `queued` and the page offers Parse. A
-- workflow that started never sets it, however long it waits to run.
alter table public.materials
  add column parse_start_failed boolean not null default false;

comment on column public.materials.parse_start_failed is 'True while a queued Material''s workflow could not start. Written by record_parse_start_failure and queue_material_parse only.';

-- Marks one of the signed-in Student's `queued` Materials as not started,
-- after the server's `start()` of its workflow failed; true when it did.
create function public.record_parse_start_failure(material_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with marked as (
    update public.materials
    set parse_start_failed = true
    where id = record_parse_start_failure.material_id
      and owner = (select auth.uid())
      and parse_status = 'queued'
    returning id
  )
  select exists (select 1 from marked);
$$;

comment on function public.record_parse_start_failure(uuid) is 'Marks the caller''s queued Material as not started; true when it did.';

-- Moves one of the signed-in Student's Materials to `queued` and says
-- whether it did: when it was never parsed, its parse failed, or its
-- workflow did not start. The conditional update lets only one of two
-- concurrent calls (a double click, two tabs) through, so the caller starts
-- one workflow.
create function public.queue_material_parse(material_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with queued as (
    update public.materials
    set parse_status = 'queued', parse_failure = null, parse_start_failed = false
    where id = queue_material_parse.material_id
      and owner = (select auth.uid())
      and (
        parse_status in ('not_parsed', 'failed')
        or (parse_status = 'queued' and parse_start_failed)
      )
    returning id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_material_parse(uuid) is 'Queues a parse of the caller''s Material if it is not_parsed, failed or queued without a started workflow; true when it did.';

revoke execute on function public.record_parse_start_failure(uuid) from public, anon;
grant execute on function public.record_parse_start_failure(uuid) to authenticated;
revoke execute on function public.queue_material_parse(uuid) from public, anon;
grant execute on function public.queue_material_parse(uuid) to authenticated;
