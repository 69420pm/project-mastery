-- Parse and Retry (#55): moves one of the signed-in Student's Materials to
-- `queued` and says whether it did. It does so when the Material was never
-- parsed, its parse failed, or it has waited 5 minutes in `queued` without
-- its workflow picking it up (starting the workflow failed at upload); the
-- workflow moves it to `parsing` at once, and only a rename touches it
-- otherwise. The conditional update lets only one of two concurrent calls
-- (a double click, two tabs) through, so the caller starts one workflow.
-- Students cannot write the parse columns themselves, so it runs with its
-- owner's rights and checks the owner itself.
-- The 5 minutes match QUEUED_STALE_MS in
-- src/features/ingestion/domain/parse-state.ts.

create function public.queue_material_parse(material_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with queued as (
    update public.materials
    set parse_status = 'queued', parse_failure = null
    where id = queue_material_parse.material_id
      and owner = (select auth.uid())
      and (
        parse_status in ('not_parsed', 'failed')
        or (parse_status = 'queued' and updated_at < now() - interval '5 minutes')
      )
    returning id
  )
  select exists (select 1 from queued);
$$;

comment on function public.queue_material_parse(uuid) is 'Queues a parse of the caller''s Material if it is not_parsed, failed or queued without starting for 5 minutes; true when it did.';

revoke execute on function public.queue_material_parse(uuid) from public, anon;
grant execute on function public.queue_material_parse(uuid) to authenticated;
