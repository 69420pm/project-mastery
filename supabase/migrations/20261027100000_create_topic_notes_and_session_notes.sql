-- Topic notes and Session notes (#187). The `close` call (service role) writes
-- a Session note when a Study session ends and replaces its Topic's Topic
-- note; the tutor reads both on every reply. Students only read them.

-- The Topic note: what the AI noted about a Student's study of one Topic,
-- replaced by each learn session that closes. It goes with its Topic.
create table public.topic_notes (
  topic_id uuid primary key references public.topics (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) <= 1500),
  updated_at timestamptz not null default now()
);

comment on table public.topic_notes is 'What the AI noted about a Student''s study of one Topic, at most 1,500 characters. The service role writes it; the Student reads it.';

create index topic_notes_owner_idx on public.topic_notes (owner);

alter table public.topic_notes enable row level security;

create policy "Students can read their own topic notes"
on public.topic_notes for select to authenticated
using ((select auth.uid()) = owner);

revoke all on table public.topic_notes from anon, authenticated;
grant select on table public.topic_notes to authenticated;

-- The Session note and the close's claim. Students read both with the rest
-- of the session (table-wide select) and write neither: no column grant.
alter table public.study_sessions
  add column session_note text check (char_length(session_note) <= 300),
  add column close_started_at timestamptz;

comment on column public.study_sessions.session_note is 'Two lines on what happened in the session and what is next, written by the close call; null until closed.';
comment on column public.study_sessions.close_started_at is 'When the close call claimed the ended session; null until then. A session with a claim and no note was not closed (no Chat, or no Student message).';
