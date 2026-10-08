-- Chats between a Student and the AI, and their messages (#22).

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- Null until the AI names the Chat; the UI shows the first message instead.
  title text check (char_length(title) <= 200),
  -- A Student's own name for the Chat, which automatic titling never replaces.
  title_set_manually boolean not null default false,
  -- The key of the model choice last used in this Chat (AI_TASKS.chat.choices).
  model_choice text not null default 'balanced' check (char_length(model_choice) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chats is 'A Chat between a Student and the AI. Created with its first message.';

create index chats_owner_updated_at_idx on public.chats (owner, updated_at desc);

create trigger chats_set_updated_at
before update on public.chats
for each row execute function private.set_updated_at();

create table public.chat_messages (
  -- Ids come from the AI SDK: the client's for Student messages, the
  -- server's for AI messages.
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- The message parts as stored by the AI SDK (UIMessage.parts).
  parts jsonb not null check (jsonb_typeof(parts) = 'array'),
  -- The model that wrote an AI message.
  model_id text check (char_length(model_id) <= 200),
  -- Whether the reply was stopped before it ended.
  stopped boolean not null default false,
  -- clock_timestamp, not now: messages saved in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp(),
  check ((role = 'assistant') = (model_id is not null))
);

comment on table public.chat_messages is 'The messages of a Chat, in the AI SDK UIMessage format, ordered by created_at.';

create index chat_messages_chat_id_created_at_idx on public.chat_messages (chat_id, created_at);

-- Row Level Security: a Student reads and changes only their own Chats and
-- the messages in them.
alter table public.chats enable row level security;

create policy "Students can read their own chats"
on public.chats
for select
to authenticated
using ((select auth.uid()) = owner);

create policy "Students can create their own chats"
on public.chats
for insert
to authenticated
with check ((select auth.uid()) = owner);

create policy "Students can update their own chats"
on public.chats
for update
to authenticated
using ((select auth.uid()) = owner)
with check ((select auth.uid()) = owner);

create policy "Students can delete their own chats"
on public.chats
for delete
to authenticated
using ((select auth.uid()) = owner);

alter table public.chat_messages enable row level security;

create policy "Students can read messages of their own chats"
on public.chat_messages
for select
to authenticated
using (
  exists (
    select 1 from public.chats
    where chats.id = chat_messages.chat_id and chats.owner = (select auth.uid())
  )
);

create policy "Students can add messages to their own chats"
on public.chat_messages
for insert
to authenticated
with check (
  exists (
    select 1 from public.chats
    where chats.id = chat_messages.chat_id and chats.owner = (select auth.uid())
  )
);

-- Regenerating or retrying a reply replaces the stored one.
create policy "Students can delete messages of their own chats"
on public.chat_messages
for delete
to authenticated
using (
  exists (
    select 1 from public.chats
    where chats.id = chat_messages.chat_id and chats.owner = (select auth.uid())
  )
);

-- Grant only what the policies allow. The owner never changes, and stored
-- messages are never edited.
revoke all on table public.chats from anon, authenticated;
grant select, insert, delete on table public.chats to authenticated;
grant update (title, title_set_manually, model_choice) on table public.chats to authenticated;

revoke all on table public.chat_messages from anon, authenticated;
grant select, insert, delete on table public.chat_messages to authenticated;
