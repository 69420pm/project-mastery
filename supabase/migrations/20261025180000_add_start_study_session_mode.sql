-- Switches a new Study session from learn to review or practice (#184). A
-- Student cannot write the session's `mode`, so the Chat's first request
-- does it through this function, right after the Chat is created.

-- Sets a running session's mode, once: false, changing nothing, when the
-- session is not the caller's, has ended, has a Topic or a question, or the
-- mode is not review or practice.
create function public.start_study_session_mode(
  p_session_id uuid,
  p_mode text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_mode is distinct from 'review' and p_mode is distinct from 'practice' then
    return false;
  end if;
  update public.study_sessions s
  set mode = p_mode
  where s.id = p_session_id
    and s.owner = (select auth.uid())
    and s.mode = 'learn'
    and s.topic_id is null
    and s.ended_at is null
    and not exists (
      select 1 from public.questions q where q.session_id = s.id
    );
  return found;
end;
$$;

comment on function public.start_study_session_mode(uuid, text) is 'Sets the caller''s running session''s mode to review or practice, once; false when it has a Topic or a question, has ended, or the mode is not review or practice.';

revoke execute on function public.start_study_session_mode(uuid, text) from public, anon;
grant execute on function public.start_study_session_mode(uuid, text) to authenticated;
