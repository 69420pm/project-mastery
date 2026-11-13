-- Fewer calls (#281). A page batch answer gives a page of only titles or
-- contents a skip reason, stored `titles`; it is not read again.

alter table public.material_pages
  drop constraint material_pages_skipped_check,
  add constraint material_pages_skipped_check
    check (skipped in ('blank', 'overlay', 'unreadable', 'uncovered', 'titles'));

comment on column public.material_pages.skipped is 'Why the page was not read: blank (almost all white), overlay (a slide build-up the next page repeats), unreadable (its page call failed after its retries), uncovered (read again alone, its answer still had no unit on it) or titles (the answer says it has only titles or contents). Null for a read page.';
