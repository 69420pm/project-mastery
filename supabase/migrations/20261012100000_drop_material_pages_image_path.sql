-- Figures are shown from the Material's own file now (a page and a box), and
-- pages are rendered for the page call and not stored, so a parse keeps no
-- page images or figure crops in Storage. The page result no longer names an
-- image, and a chunk's figure is { "description", "page", "box" }.

-- Parses stored before this change have figures that name a picture in
-- Storage: parse those Materials again. Their chunks go, with the exercise
-- pairs of those chunks; the next parse pairs the Course again.
with stale as (
  select distinct material_id
  from public.material_pages
  where jsonb_path_exists(units, '$[*].figure.cropPath')
),
removed_chunks as (
  delete from public.chunks where material_id in (select material_id from stale)
),
removed_pages as (
  delete from public.material_pages where material_id in (select material_id from stale)
)
update public.materials
set parse_status = 'not_parsed', pages_total = null, pages_done = 0,
    parse_failure = null, is_exam = null, exam_year = null, exam_total_points = null
where id in (select material_id from stale);

alter table public.material_pages drop column image_path;

comment on table public.material_pages is 'The stored result of one page call of a Material parse: its units.';
comment on column public.chunks.figure is 'A non-decorative figure: { "description": text, "page": number, "box": { x, y, width, height } or null }. The box is normalized to the page (0 to 1, from the top left); null means the whole page.';
