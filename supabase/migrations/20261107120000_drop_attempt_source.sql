-- Nothing reads where an Attempt was made: a Mock exam's Attempts are those
-- of its session, which has no Chat. Databases that applied an earlier
-- version of 20261106150000 have the column; others never get it.

alter table public.attempts drop column if exists source;
