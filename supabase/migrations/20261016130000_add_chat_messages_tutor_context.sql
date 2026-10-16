-- The tutor context an AI reply was given (#117), so a Chat can show it next
-- to the reply: the `TutorContext` that `startTutoring` built, the object
-- `tutorInstructions` receives. Only AI replies have one; Student messages
-- and replies from before this column stay null. Only displayed, so RLS
-- doesn't change, and the table-level insert grant already covers it.
alter table public.chat_messages
  add column tutor_context jsonb
  check (tutor_context is null or jsonb_typeof(tutor_context) = 'object');

comment on column public.chat_messages.tutor_context is 'The TutorContext an AI reply was given; null for Student messages and older replies.';
