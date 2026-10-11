-- Page results and chunks of a parsed Material (#54). Only the parse
-- workflow (service role) writes them; a Student reads their own.

-- One row per page whose page call has finished, so a retried parse skips it.
create table public.material_pages (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  -- 1-based, as the Student counts pages.
  page_number integer not null check (page_number >= 1),
  -- The page image in the course-files bucket: a rendered PDF page, or the
  -- uploaded image itself.
  image_path text not null check (char_length(image_path) between 1 and 500),
  -- The page call's ordered units (src/features/ingestion/ai/page-units.ts).
  -- Internal, never shown.
  units jsonb not null check (jsonb_typeof(units) = 'array'),
  created_at timestamptz not null default now(),
  unique (material_id, page_number)
);

comment on table public.material_pages is 'The stored result of one page call of a Material parse: its image path and units.';

create index material_pages_owner_idx on public.material_pages (owner);

-- The labeled markdown units a Material is parsed into, in reading order.
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  -- 0-based reading order within the Material.
  position integer not null check (position >= 0),
  page_from integer not null check (page_from >= 1),
  page_to integer not null check (page_to >= page_from),
  label text not null check (
    label in ('content', 'definition', 'example', 'exercise', 'solution', 'figure', 'admin')
  ),
  -- In the source language, with LaTeX math and Mermaid code blocks.
  markdown text not null,
  -- A non-decorative figure: { "description": text, "cropPath": text or null }.
  figure jsonb check (figure is null or jsonb_typeof(figure) = 'object'),
  -- As printed, such as "7.2a".
  exercise_number text check (char_length(exercise_number) between 1 and 50),
  points numeric check (points >= 0),
  created_at timestamptz not null default now(),
  unique (material_id, position)
);

comment on table public.chunks is 'A labeled markdown unit of a parsed Material, with the pages it came from.';

create index chunks_owner_idx on public.chunks (owner);
create index chunks_course_id_idx on public.chunks (course_id);

-- Row Level Security: owners read their own rows; writes come only from the
-- workflow's service role, and deletes cascade from the Material.
alter table public.material_pages enable row level security;
alter table public.chunks enable row level security;

create policy "Students can read their own material pages"
on public.material_pages
for select
to authenticated
using ((select auth.uid()) = owner);

create policy "Students can read their own chunks"
on public.chunks
for select
to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.material_pages from anon, authenticated;
revoke all on table public.chunks from anon, authenticated;
grant select on table public.material_pages to authenticated;
grant select on table public.chunks to authenticated;
