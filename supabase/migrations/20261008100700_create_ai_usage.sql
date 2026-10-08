-- One record per AI call made for a Student, priced in US dollars from the
-- static price table (ADR 0006). Today's spend against the Daily limit is the
-- sum of the Student's records since 00:00 UTC.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  -- Deleted with the account.
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- The AI task that made the call (AI_TASKS in src/lib/ai/models.ts).
  task text not null check (char_length(task) between 1 and 50),
  model_id text not null check (char_length(model_id) between 1 and 200),
  -- All input tokens, cached ones included.
  input_tokens integer not null check (input_tokens >= 0),
  cached_input_tokens integer not null default 0
    check (cached_input_tokens >= 0 and cached_input_tokens <= input_tokens),
  -- All output tokens, reasoning included.
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric not null check (cost_usd >= 0),
  -- Whether the tokens were estimated, as for an aborted call that reported no usage.
  estimated boolean not null default false,
  -- The Chat the call was made for, if any. Spend stays when the Chat is deleted.
  chat_id uuid references public.chats (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.ai_usage is 'One record per AI call made for a Student, with its tokens and cost in USD. Counts against the Daily limit.';

create index ai_usage_owner_created_at_idx on public.ai_usage (owner, created_at);
create index ai_usage_chat_id_idx on public.ai_usage (chat_id);

-- Row Level Security: the server records usage as the Student, so a Student
-- may read and add their own records, but never change or delete them and so
-- never erase their own spend.
alter table public.ai_usage enable row level security;

create policy "Students can read their own AI usage"
on public.ai_usage
for select
to authenticated
using ((select auth.uid()) = owner);

create policy "Students can record their own AI usage"
on public.ai_usage
for insert
to authenticated
with check (
  (select auth.uid()) = owner
  and (
    chat_id is null
    or exists (
      select 1 from public.chats
      where chats.id = ai_usage.chat_id and chats.owner = (select auth.uid())
    )
  )
);

-- No update or delete, and created_at is always the time of recording, so
-- spend cannot be moved out of today.
revoke all on table public.ai_usage from anon, authenticated;
grant select on table public.ai_usage to authenticated;
grant insert (owner, task, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd, estimated, chat_id)
on table public.ai_usage to authenticated;
