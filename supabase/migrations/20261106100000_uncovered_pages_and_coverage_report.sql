-- Calls that fit, coverage, pages (#249 slice 1). A page that no unit of
-- its batch covers is read again alone; still uncovered, it is stored
-- `uncovered`. The check report gains the units below the coverage bar and
-- the pages read without units, so reports of earlier builds are dropped:
-- the next Update map stores a new one.

alter table public.material_pages
  drop constraint material_pages_skipped_check,
  add constraint material_pages_skipped_check
    check (skipped in ('blank', 'overlay', 'unreadable', 'uncovered'));

comment on column public.material_pages.skipped is 'Why the page was not read: blank (almost all white), overlay (a slide build-up the next page repeats), unreadable (its page call failed after its retries) or uncovered (read again alone, its answer still had no unit on it). Null for a read page.';

update public.knowledge_map_builds set check_report = null;
