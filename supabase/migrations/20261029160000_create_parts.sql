-- Chunks and Parts (#223, slice 7 of #222): the parse joins page units into
-- chunks and groups them into Parts in code, and stores both in one
-- transaction. Points, figure objects and exam metadata are gone: nothing
-- reads them.

alter table public.chunks
  drop column points,
  drop column figure;

alter table public.materials
  drop column exam_year,
  drop column exam_total_points;

-- A Part: a run of one Material's chunks under one heading, the unit the
-- map build extracts KCs from.
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  -- 0-based, in the order of the Parts' first chunks.
  position integer not null check (position >= 0),
  kind text not null check (kind in ('teaching', 'exercise')),
  title text not null check (char_length(title) between 1 and 500),
  chapter_title text not null check (char_length(chapter_title) between 1 and 500),
  page_from integer not null check (page_from >= 1),
  page_to integer not null check (page_to >= page_from),
  -- SHA-256 of its chunks' Markdown, in order.
  content_hash text not null check (char_length(content_hash) = 64),
  created_at timestamptz not null default now(),
  unique (material_id, position)
);

comment on table public.parts is 'A run of one Material''s chunks under one heading, found in code by the parse: the unit the map build extracts KCs from. Teaching Parts hold content chunks, exercise Parts exercise or solution chunks.';

create index parts_owner_idx on public.parts (owner);
create index parts_course_id_idx on public.parts (course_id);

alter table public.parts enable row level security;

create policy "Students can read their own parts"
on public.parts
for select
to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.parts from anon, authenticated;
grant select on table public.parts to authenticated;

-- Set for every non-admin chunk of a parse; admin chunks belong to no Part.
alter table public.chunks
  add column part_id uuid references public.parts (id) on delete set null;

create index chunks_part_id_idx on public.chunks (part_id);

-- The parse workflow's write of a Material's chunks and Parts: in one
-- transaction, it replaces any earlier ones of the Material. A failed write
-- keeps them.
--
-- p_parts is a jsonb array of objects with the part columns position, kind,
-- title, chapter_title, page_from, page_to and content_hash. p_chunks is a
-- jsonb array of objects with the chunk columns position, page_from,
-- page_to, label, markdown and exercise_number, and part_position: the
-- position of its Part, or null for an admin chunk. Owner and Course come
-- from the Material. Runs as its caller: only the service role may call it.
drop function public.replace_material_chunks(uuid, jsonb);

create function public.replace_material_chunks(
  p_material_id uuid,
  p_parts jsonb,
  p_chunks jsonb
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
  delete from public.parts where material_id = p_material_id;

  insert into public.parts (
    owner, course_id, material_id, position, kind, title, chapter_title,
    page_from, page_to, content_hash
  )
  select
    v_owner, v_course_id, p_material_id, p.position, p.kind, p.title,
    p.chapter_title, p.page_from, p.page_to, p.content_hash
  from jsonb_to_recordset(p_parts) as p (
    position integer, kind text, title text, chapter_title text,
    page_from integer, page_to integer, content_hash text
  );

  insert into public.chunks (
    owner, course_id, material_id, position, page_from, page_to, label,
    markdown, exercise_number, part_id
  )
  select
    v_owner, v_course_id, p_material_id, c.position, c.page_from, c.page_to,
    c.label, c.markdown, c.exercise_number, p.id
  from jsonb_to_recordset(p_chunks) as c (
    position integer, page_from integer, page_to integer, label text,
    markdown text, exercise_number text, part_position integer
  )
  left join public.parts as p
    on p.material_id = p_material_id and p.position = c.part_position;
end;
$$;

comment on function public.replace_material_chunks(uuid, jsonb, jsonb) is
  'Replaces a Material''s chunks and Parts in one transaction. Parse workflow (service role) only.';

revoke execute on function public.replace_material_chunks(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_material_chunks(uuid, jsonb, jsonb)
  to service_role;
