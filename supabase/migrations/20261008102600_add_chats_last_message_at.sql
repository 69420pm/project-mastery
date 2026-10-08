-- The sidebar lists a Student's Chats newest first, by their latest message
-- (#26). updated_at also moves on a rename or a model change, so a separate
-- column, kept by a trigger, holds the time of the latest message.

alter table public.chats
add column last_message_at timestamptz not null default now();

comment on column public.chats.last_message_at is 'When the latest message was added; the Chat list is ordered by it.';

update public.chats
set last_message_at = coalesce(
  (select max(created_at) from public.chat_messages where chat_id = chats.id),
  created_at
);

drop index public.chats_owner_updated_at_idx;
create index chats_owner_last_message_at_idx on public.chats (owner, last_message_at desc);

-- Runs as its owner: Students have no update privilege on this column, and
-- the insert policy on chat_messages has already checked the Chat is theirs.
create function private.touch_chat_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chats
  set last_message_at = new.created_at
  where id = new.chat_id and last_message_at < new.created_at;
  return new;
end;
$$;

revoke execute on function private.touch_chat_last_message_at() from public, anon, authenticated;

create trigger chat_messages_touch_chat
after insert on public.chat_messages
for each row execute function private.touch_chat_last_message_at();
