-- Remove the old Chat orchestration (#251): session modes and Stages, the
-- question kinds, Session notes, map Findings and reading Done. Every Chat is
-- one kind of Study session. Chats, sessions, Questions, Attempts, Mock exams
-- and Topic notes are deleted first, since what they recorded no longer
-- fits; nothing is migrated.

delete from public.chats;
delete from public.mock_exams;
delete from public.study_sessions;
delete from public.topic_notes;

drop function public.start_study_session_mode(uuid, text, uuid);
drop function public.start_study_session_topic(uuid, uuid, text);
drop function public.set_study_session_stage(uuid, text);
drop function public.accept_map_finding(uuid);
drop function public.store_session_close(
  uuid, text, text[], text, text, timestamptz
);

drop table public.map_findings;

alter table public.chat_messages drop column reading_section_id;

-- A mock exam's Question is now one that a mock item poses, as the kind no
-- longer says it.
drop trigger questions_check_mock_answer on public.questions;

alter table public.questions drop column kind;

-- A Mock exam's Question's answer and confidence change only while its mock
-- is in progress and before its deadline: a minute after its time is up, so
-- an answer saved at 0 still lands. Other Questions are left alone. Runs as
-- the caller.
create or replace function private.check_mock_answer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.mock_items i where i.question_id = new.id
  ) then
    return new;
  end if;
  if not exists (
    select 1
    from public.mock_items i
    join public.mock_exams m on m.id = i.mock_id
    where i.question_id = new.id
      and m.status = 'in_progress'
      and now() < m.started_at + make_interval(mins => m.duration_minutes + 1)
  ) then
    raise exception 'The mock exam is not running'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger questions_check_mock_answer
before update on public.questions
for each row
when (
  new.answer_text is distinct from old.answer_text
  or new.confidence is distinct from old.confidence
  or new.answered_at is distinct from old.answered_at
)
execute function private.check_mock_answer();

alter table public.study_sessions
  drop column mode,
  drop column topic_id,
  drop column stage,
  drop column session_note,
  -- When the close's notes were stored, which a retried store checks.
  add column closed_at timestamptz;

create or replace function private.start_study_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.study_sessions (owner, chat_id, course_id)
  values (new.owner, new.id, new.course_id);
  return new;
end;
$$;

create or replace function public.start_mock_exam(p_mock_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mock public.mock_exams;
  v_session uuid;
  v_item record;
  v_question uuid;
begin
  select * into v_mock
  from public.mock_exams m
  where m.id = p_mock_id
    and m.owner = (select auth.uid())
    and m.status = 'ready'
  for update;
  if not found then
    return false;
  end if;

  insert into public.study_sessions (owner, course_id)
  values (v_mock.owner, v_mock.course_id)
  returning id into v_session;

  for v_item in
    select i.id, i.prompt, i.exercise_id, i.problem_id
    from public.mock_items i
    where i.mock_id = p_mock_id
    order by i.position
  loop
    insert into public.questions (owner, session_id, prompt, exercise_id, problem_id)
    values (v_mock.owner, v_session, v_item.prompt, v_item.exercise_id, v_item.problem_id)
    returning id into v_question;

    insert into public.question_kcs (question_id, kc_id)
    select v_question, k.kc_id from public.exercise_kcs k where k.exercise_id = v_item.exercise_id
    union
    select v_question, k.kc_id from public.problem_kcs k where k.problem_id = v_item.problem_id;

    update public.mock_items set question_id = v_question where id = v_item.id;
  end loop;

  update public.mock_exams
  set status = 'in_progress', started_at = now(), session_id = v_session
  where id = p_mock_id;
  return true;
end;
$$;

-- The close call's Memory lines, and its condensed Memory when the Memory
-- has not changed since the call read it at `p_memory_read_at`. Once per
-- session: false, storing nothing, when its close is stored already.
create function public.store_session_close(
  p_session_id uuid,
  p_memory_lines text[],
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

comment on function public.store_session_close(uuid, text[], text, timestamptz) is
  'Stores a closed Study session''s condensed Memory and Memory lines in one transaction, once. closeStudySession workflow (service role) only.';

revoke execute on function public.store_session_close(uuid, text[], text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_session_close(uuid, text[], text, timestamptz)
  to service_role;
