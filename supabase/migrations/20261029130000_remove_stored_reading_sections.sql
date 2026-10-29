-- Reading sections are cut when read (#224, slice 4 of #222): code cuts a
-- Topic's sections from the chunks its KCs cite and gives each a UUID v5 of
-- its Topic, Material and pages, so `chat_messages.reading_section_id` keeps
-- matching while the cut stays the same. Removes the stored sections with
-- their reading modes, annotations and study texts.

drop table public.reading_sections;
