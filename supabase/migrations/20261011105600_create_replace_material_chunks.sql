-- The parse workflow's write of a Material's chunks (#56): in one
-- transaction, it replaces any earlier chunks of the Material and stores the
-- exam metadata the file call found. A failed write keeps the earlier chunks.
--
-- p_chunks is a jsonb array of objects with the chunk columns position,
-- page_from, page_to, label, markdown, figure, exercise_number and points.
-- Owner and Course come from the Material. Runs as its caller: only the
-- service role may call it.
create function public.replace_material_chunks(
  p_material_id uuid,
  p_chunks jsonb,
  p_is_exam boolean,
  p_exam_year integer default null,
  p_exam_total_points numeric default null
)
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
    markdown, figure, exercise_number, points
  )
  select
    v_owner, v_course_id, p_material_id, c.position, c.page_from, c.page_to,
    c.label, c.markdown, c.figure, c.exercise_number, c.points
  from jsonb_to_recordset(p_chunks) as c (
    position integer, page_from integer, page_to integer, label text,
    markdown text, figure jsonb, exercise_number text, points numeric
  );

  update public.materials
  set
    is_exam = p_is_exam,
    exam_year = case when p_is_exam then p_exam_year end,
    exam_total_points = case when p_is_exam then p_exam_total_points end
  where id = p_material_id;
end;
$$;

comment on function public.replace_material_chunks(uuid, jsonb, boolean, integer, numeric) is
  'Replaces a Material''s chunks and stores its exam metadata in one transaction. Parse workflow (service role) only.';

revoke execute on function public.replace_material_chunks(uuid, jsonb, boolean, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.replace_material_chunks(uuid, jsonb, boolean, integer, numeric)
  to service_role;
