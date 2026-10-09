-- Every Chat belongs to one Course (#41). Existing Chats have no Course to
-- go in, and there are no real users yet, so they are deleted with their
-- messages. Their usage records stay (ai_usage.chat_id is on delete set null).

delete from public.chats;

alter table public.chats
add column course_id uuid not null references public.courses (id) on delete cascade;

comment on column public.chats.course_id is 'The Course the Chat belongs to. It never moves.';

-- The sidebar lists a Course's Chats by their latest message.
create index chats_course_id_last_message_at_idx on public.chats (course_id, last_message_at desc);

-- A Chat can only be created in the Student's own Course. The course_id
-- column is not granted for update, so a Chat never moves.
drop policy "Students can create their own chats" on public.chats;

create policy "Students can create their own chats"
on public.chats
for insert
to authenticated
with check (
  (select auth.uid()) = owner
  and exists (
    select 1 from public.courses
    where courses.id = chats.course_id and courses.owner = (select auth.uid())
  )
);

-- A message in a Chat marks its Course as just used, so the Course list
-- sorts by recent use. Runs as its owner: Students may only change a
-- Course's name, and the insert policy on chat_messages has already checked
-- the Chat is theirs. The courses trigger sets updated_at.
create function private.touch_course_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.courses
  set updated_at = now()
  where id = (select course_id from public.chats where id = new.chat_id);
  return new;
end;
$$;

revoke execute on function private.touch_course_updated_at() from public, anon, authenticated;

create trigger chat_messages_touch_course
after insert on public.chat_messages
for each row execute function private.touch_course_updated_at();
