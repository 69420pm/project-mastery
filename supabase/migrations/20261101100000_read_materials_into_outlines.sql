-- Page batches and Outlines (#228, slices 12–15 of #222). A Material is
-- read in batches of pages whose units carry no language and no exercise
-- number; Parts and their store function go. A Material gets an Outline of
-- Chapters, a language and notes. Changes the schema only: no rows exist
-- (#222, Shipping).

-- Page batches ----------------------------------------------------------------

alter table public.material_pages drop column language;

comment on column public.material_pages.units is 'The units of a page batch that start on this page, in reading order: markdown, label (heading, content, exercise, solution, admin), pageFrom, pageTo, a heading''s style and whether it continues across a batch edge.';

-- Parts go: the build marks the map built without calls until it works from
-- Chapters (#229). Their extractions stay until then, without a foreign key.
drop function public.store_part_kcs(uuid, jsonb, jsonb, jsonb);

alter table public.chunks drop column part_id;

drop table public.parts cascade;

-- Outlines ----------------------------------------------------------------------

-- A Chapter of a Material's Outline: the structure call of a parse decides
-- the tree from all the Material's headings at once. Every Material that
-- has chunks has a root Chapter (depth 0) titled by its name.
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  parent_id uuid references public.chapters (id) on delete cascade,
  -- 0-based, in reading order: a Chapter comes after its parent.
  position integer not null check (position >= 0),
  depth integer not null check (depth >= 0),
  title text not null check (char_length(title) between 1 and 500),
  page_from integer not null check (page_from >= 1),
  exam_proposed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (material_id, position),
  constraint chapters_root_has_no_parent check ((parent_id is null) = (depth = 0))
);

comment on table public.chapters is 'A Chapter of a Material''s Outline, decided by the parse''s structure call: a tree below the root Chapter, which is titled by the Material''s name.';
comment on column public.chapters.exam_proposed is 'The structure call took the Chapter for an old exam, a class test or its solutions; the Brief confirms old exams.';

create index chapters_owner_idx on public.chapters (owner);
create index chapters_course_id_idx on public.chapters (course_id);
create index chapters_parent_id_idx on public.chapters (parent_id);

alter table public.chapters enable row level security;

create policy "Students can read their own chapters"
on public.chapters
for select
to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.chapters from anon, authenticated;
grant select on table public.chapters to authenticated;

-- Set by every parse: the deepest Chapter the chunk is in.
alter table public.chunks
  add column chapter_id uuid references public.chapters (id) on delete set null;

create index chunks_chapter_id_idx on public.chunks (chapter_id);

alter table public.materials
  add column notes text check (char_length(notes) <= 1000);

comment on column public.materials.language is 'The Material''s language as an English name, such as German, from the parse''s structure call; null until then or when the call failed.';
comment on column public.materials.notes is 'Non-standard notation and conventions of the Material, from the parse''s structure call; empty when it has none, null until then or when the call failed.';

-- The parse workflow's write of a Material's Outline and chunks: in one
-- transaction, it replaces any earlier ones of the Material. A failed write
-- keeps them.
--
-- p_chapters is a jsonb array of objects with the chapter columns position,
-- depth, title, page_from and exam_proposed, and parent_position: the
-- position of its parent, null for the root. p_chunks is a jsonb array of
-- objects with the chunk columns position, page_from, page_to, label and
-- markdown, and chapter_position: the position of its Chapter. Owner and
-- Course come from the Material. Runs as its caller: only the service role
-- may call it.
drop function public.replace_material_chunks(uuid, jsonb, jsonb);

create function public.replace_material_chunks(
  p_material_id uuid,
  p_chapters jsonb,
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
  delete from public.chapters where material_id = p_material_id;

  -- Ids first, so a Chapter's parent is found by its position. A parent
  -- position without a Chapter leaves the parent null, which only the root
  -- may have.
  with c as (
    select gen_random_uuid() as id, r.*
    from jsonb_to_recordset(p_chapters) as r (
      position integer, parent_position integer, depth integer, title text,
      page_from integer, exam_proposed boolean
    )
  )
  insert into public.chapters (
    id, owner, course_id, material_id, parent_id, position, depth, title,
    page_from, exam_proposed
  )
  select
    c.id, v_owner, v_course_id, p_material_id, parent.id, c.position, c.depth,
    c.title, c.page_from, coalesce(c.exam_proposed, false)
  from c
  left join c as parent on parent.position = c.parent_position;

  insert into public.chunks (
    owner, course_id, material_id, chapter_id, position, page_from, page_to,
    label, markdown
  )
  select
    v_owner, v_course_id, p_material_id, chapter.id, c.position, c.page_from,
    c.page_to, c.label, c.markdown
  from jsonb_to_recordset(p_chunks) as c (
    position integer, page_from integer, page_to integer, label text,
    markdown text, chapter_position integer
  )
  left join public.chapters as chapter
    on chapter.material_id = p_material_id
    and chapter.position = c.chapter_position;
end;
$$;

comment on function public.replace_material_chunks(uuid, jsonb, jsonb) is
  'Replaces a Material''s Chapters and chunks in one transaction. Parse workflow (service role) only.';

revoke execute on function public.replace_material_chunks(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_material_chunks(uuid, jsonb, jsonb)
  to service_role;
