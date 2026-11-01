-- Page batches and Outlines (#228, slices 12–15 of #222). A Material is
-- read in batches of pages whose units carry no language and no exercise
-- number; Parts and their store function go. Changes the schema only: no
-- rows exist (#222, Shipping).

-- Page batches ----------------------------------------------------------------

alter table public.material_pages drop column language;

comment on column public.material_pages.units is 'The units of a page batch that start on this page, in reading order: markdown, label (heading, content, exercise, solution, admin), pageFrom, pageTo, a heading''s style and whether it continues across a batch edge.';

comment on column public.materials.language is 'The Material''s language, null until the parse names it.';

-- Parts go: the build marks the map built without calls until it works from
-- Chapters (#229). Their extractions stay until then, without a foreign key.
drop function public.store_part_kcs(uuid, jsonb, jsonb, jsonb);

alter table public.chunks drop column part_id;

drop table public.parts cascade;

-- The parse workflow's write of a Material's chunks: in one transaction, it
-- replaces any earlier chunks of the Material. A failed write keeps them.
--
-- p_chunks is a jsonb array of objects with the chunk columns position,
-- page_from, page_to, label and markdown. Owner and Course come from the
-- Material. Runs as its caller: only the service role may call it.
drop function public.replace_material_chunks(uuid, jsonb, jsonb);

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
    owner, course_id, material_id, position, page_from, page_to, label, markdown
  )
  select
    v_owner, v_course_id, p_material_id, c.position, c.page_from, c.page_to,
    c.label, c.markdown
  from jsonb_to_recordset(p_chunks) as c (
    position integer, page_from integer, page_to integer, label text,
    markdown text
  );
end;
$$;

comment on function public.replace_material_chunks(uuid, jsonb) is
  'Replaces a Material''s chunks in one transaction. Parse workflow (service role) only.';

revoke execute on function public.replace_material_chunks(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_material_chunks(uuid, jsonb)
  to service_role;
