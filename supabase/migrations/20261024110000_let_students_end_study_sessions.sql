-- Tutoring M2 (#174): a Student ends their Study session with End session,
-- and the chat handler ends one gone idle for 2 hours at its newest message.
-- Both write `ended_at` as the Student, so they may update that column, and
-- only on their own sessions.

comment on column public.study_sessions.ended_at is 'When the session ended: End session, or its newest message once it was idle for 2 hours. Null while it runs, or until a message to an idle session writes it.';

create policy "Students can end their own study sessions"
on public.study_sessions for update to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

grant update (ended_at) on table public.study_sessions to authenticated;
