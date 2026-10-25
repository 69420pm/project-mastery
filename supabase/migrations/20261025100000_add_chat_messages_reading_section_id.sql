-- The Reading section a Student's "Done reading." message is for (#179),
-- sent with Done on a reading card. A reading card counts as done once a
-- later Student message names its section. Not a foreign key: the handler
-- checks only the id's format, and a message keeps its id when its section
-- is rebuilt or deleted. Only Student messages have one; RLS doesn't change,
-- and the table-level insert grant already covers it.
alter table public.chat_messages
  add column reading_section_id uuid
  check (reading_section_id is null or role = 'user');

comment on column public.chat_messages.reading_section_id is 'The Reading section a Student message marks as read; null otherwise.';
