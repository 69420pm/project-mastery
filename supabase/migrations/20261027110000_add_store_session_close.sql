-- The `closeStudySession` workflow's write (#187): in one transaction, the
-- ended session's Session note, its Topic's Topic note, the condensed Memory
-- and the new Memory lines. Owner and Course come from the session. Runs as
-- its caller: only the service role may call it.
--
-- p_topic_note is written only for a learn session with a Topic; null keeps
-- the note as it is. p_condensed_memory is the condensed text whose pinned
-- lines the workflow checked (`study/domain`); it replaces the Memory only
-- while `memories.updated_at` still equals p_memory_read_at, the value the
-- workflow read, and is dropped otherwise. Each of p_memory_lines is then
-- appended as "YYYY-MM-DD: line" (UTC), like `append_memory`, skipping a
-- line that would take the Memory past 4,000 characters. False, changing
-- nothing, when the session has a Session note already or is not found.
create function public.store_session_close(
  p_session_id uuid,
  p_session_note text,
  p_memory_lines text[],
  p_topic_note text default null,
  p_condensed_memory text default null,
  p_memory_read_at timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.study_sessions;
  v_memory public.memories;
  v_text text;
  v_line text;
  v_day text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_next text;
begin
  select * into v_session
  from public.study_sessions
  where id = p_session_id
  for update;
  if not found or v_session.session_note is not null then
    return false;
  end if;

  update public.study_sessions
  set session_note = p_session_note
  where id = p_session_id;

  if p_topic_note is not null
    and v_session.mode = 'learn'
    and v_session.topic_id is not null then
    insert into public.topic_notes as n (topic_id, owner, text, updated_at)
    values (v_session.topic_id, v_session.owner, p_topic_note, now())
    on conflict (topic_id) do update
    set text = excluded.text, updated_at = excluded.updated_at;
  end if;

  select * into v_memory
  from public.memories
  where course_id = v_session.course_id
  for update;
  v_text := coalesce(v_memory.text, '');
  if p_condensed_memory is not null
    and v_memory.course_id is not null
    and v_memory.updated_at = p_memory_read_at then
    v_text := p_condensed_memory;
  end if;

  foreach v_line in array coalesce(p_memory_lines, '{}'::text[]) loop
    v_next := case when v_text = '' then '' else v_text || E'\n' end
      || v_day || ': ' || v_line;
    if char_length(v_next) <= 4000 then
      v_text := v_next;
    end if;
  end loop;

  if v_memory.course_id is null then
    if v_text <> '' then
      insert into public.memories (course_id, owner, text)
      values (v_session.course_id, v_session.owner, v_text);
    end if;
  elsif v_text is distinct from v_memory.text then
    update public.memories
    set text = v_text
    where course_id = v_session.course_id;
  end if;

  return true;
end;
$$;

comment on function public.store_session_close(uuid, text, text[], text, text, timestamptz) is
  'Stores a closed Study session''s Session note, Topic note, condensed Memory and Memory lines in one transaction. closeStudySession workflow (service role) only.';

revoke execute on function public.store_session_close(uuid, text, text[], text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_session_close(uuid, text, text[], text, text, timestamptz)
  to service_role;
