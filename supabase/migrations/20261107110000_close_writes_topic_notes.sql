-- The close call writes Topic notes again (#251): one per Topic the
-- session's Attempts touched, replacing the old note, in the same
-- transaction as the Memory.
drop function public.store_session_close(uuid, text[], text, timestamptz);

-- The `closeStudySession` workflow's write, in one transaction and once per
-- session: marks the session closed, then writes each of p_topic_notes
-- (`[{"topic_id": …, "text": …}]`) as its Topic's note, skipping a Topic of
-- another Course. p_condensed_memory replaces the Memory only while
-- `memories.updated_at` still equals p_memory_read_at, the value the
-- workflow read, and is dropped otherwise. Each of p_memory_lines is then
-- appended as "YYYY-MM-DD: line" (UTC), like `append_memory`, skipping a
-- line that would take the Memory past 4,000 characters. False, changing
-- nothing, when the session is closed already or not found. Runs as its
-- caller: only the service role may call it.
create function public.store_session_close(
  p_session_id uuid,
  p_memory_lines text[],
  p_topic_notes jsonb default '[]'::jsonb,
  p_condensed_memory text default null,
  p_memory_read_at timestamptz default null
)
returns boolean
language plpgsql
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
  if not found or v_session.closed_at is not null then
    return false;
  end if;

  update public.study_sessions
  set closed_at = now()
  where id = p_session_id;

  insert into public.topic_notes as n (topic_id, owner, text, updated_at)
  select t.id, v_session.owner, note ->> 'text', now()
  from jsonb_array_elements(coalesce(p_topic_notes, '[]'::jsonb)) as note
  join public.topics t on t.id = (note ->> 'topic_id')::uuid
  where t.course_id = v_session.course_id
  on conflict (topic_id) do update
  set text = excluded.text, updated_at = excluded.updated_at;

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

comment on function public.store_session_close(uuid, text[], jsonb, text, timestamptz) is
  'Stores a closed Study session''s Topic notes, condensed Memory and Memory lines in one transaction, once. closeStudySession workflow (service role) only.';

revoke execute on function public.store_session_close(uuid, text[], jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_session_close(uuid, text[], jsonb, text, timestamptz)
  to service_role;

comment on table public.topic_notes is 'What clicked and what kept going wrong in a Student''s study of one Topic, at most 1,500 characters, replaced by the close of each session whose Attempts touch the Topic. The service role writes it; the Student reads it.';
