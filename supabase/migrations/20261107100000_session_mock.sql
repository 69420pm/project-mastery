-- A Chat opened from a graded Mock exam goes through that mock (#251): its
-- first request sets the session's `mock_id`, which the tutor context reads.

create function public.set_session_mock(p_chat_id uuid, p_mock_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.study_sessions s
  set mock_id = p_mock_id
  where s.chat_id = p_chat_id
    and s.owner = (select auth.uid())
    and s.mock_id is null
    and s.ended_at is null
    and not exists (
      select 1 from public.questions q where q.session_id = s.id
    )
    and exists (
      select 1 from public.mock_exams m
      where m.id = p_mock_id
        and m.owner = (select auth.uid())
        and m.course_id = s.course_id
        and m.status = 'graded'
    );
  return found;
end;
$$;

comment on function public.set_session_mock(uuid, uuid) is
  'Sets the caller''s running Chat session''s mock to the caller''s graded mock of the same Course, while the session has no mock and no Question; false otherwise.';

revoke execute on function public.set_session_mock(uuid, uuid) from public, anon;
grant execute on function public.set_session_mock(uuid, uuid) to authenticated;
