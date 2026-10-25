-- Tutoring M4c (#180): a learn session teaches one Topic in stages. Its
-- first reply sets the session's Topic and start stage, and the tutor's
-- `setStage` moves it on. Both write through the functions below, which run
-- as the session's owner and keep the Topic fixed once set. The close card
-- saves the Student's rating of the session, which they write themselves.

alter table public.study_sessions drop constraint study_sessions_stage_check;
alter table public.study_sessions add constraint study_sessions_stage_check check (
  stage in ('review', 'orient', 'prime', 'read', 'work', 'apply', 'rebuild', 'close')
);

-- Topic ids stay across map updates (`replace_topics`); a removed Topic
-- leaves its sessions without one.
alter table public.study_sessions
  add constraint study_sessions_topic_id_fkey
  foreign key (topic_id) references public.topics (id) on delete set null;

-- The resume lookup: a Topic's most recent earlier session.
create index study_sessions_topic_id_started_at_idx
on public.study_sessions (topic_id, started_at);

alter table public.study_sessions
  add column rating smallint check (rating between 1 and 5),
  add column rating_note text check (char_length(rating_note) <= 300);

comment on column public.study_sessions.topic_id is 'The Topic a learn session teaches, set by its first reply and fixed after; null in a Course without Topics.';
comment on column public.study_sessions.stage is 'Where a learn session with a Topic stands: review, orient, prime, read, work, apply, rebuild or close. Null without a Topic.';
comment on column public.study_sessions.rating is 'The Student''s rating of the session, 1 to 5, from the close card; null until given.';
comment on column public.study_sessions.rating_note is 'The Student''s optional note on the session, at most 300 characters.';

-- The update policy of #174 already limits Students to their own sessions.
grant update (rating, rating_note) on table public.study_sessions to authenticated;

-- Sets a running session's Topic and start stage, once: false, changing
-- nothing, when the session is not the caller's, has ended or has a Topic,
-- or the Topic is not of its Course.
create function public.start_study_session_topic(
  p_session_id uuid,
  p_topic_id uuid,
  p_stage text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.study_sessions s
  set topic_id = p_topic_id, stage = p_stage
  where s.id = p_session_id
    and s.owner = (select auth.uid())
    and s.topic_id is null
    and s.ended_at is null
    and exists (
      select 1 from public.topics t
      where t.id = p_topic_id and t.course_id = s.course_id
    );
  return found;
end;
$$;

comment on function public.start_study_session_topic(uuid, uuid, text) is 'Sets the caller''s running session''s Topic and start stage, once; false when it has one already or the Topic is not of its Course.';

revoke execute on function public.start_study_session_topic(uuid, uuid, text) from public, anon;
grant execute on function public.start_study_session_topic(uuid, uuid, text) to authenticated;

-- Moves a running session with a Topic to a stage; false, changing nothing,
-- when it is not the caller's, has ended, has no Topic or is at close. The
-- order of stages is the tutor's rule (`setStage`), checked in code.
create function public.set_study_session_stage(p_session_id uuid, p_stage text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.study_sessions s
  set stage = p_stage
  where s.id = p_session_id
    and s.owner = (select auth.uid())
    and s.topic_id is not null
    and s.ended_at is null
    and s.stage <> 'close';
  return found;
end;
$$;

comment on function public.set_study_session_stage(uuid, text) is 'Moves the caller''s running session with a Topic to a stage; false when it has ended, has no Topic or is at close.';

revoke execute on function public.set_study_session_stage(uuid, text) from public, anon;
grant execute on function public.set_study_session_stage(uuid, text) to authenticated;
