-- The Chat reply an AI call produced (#117), so a Chat can show each reply's
-- model, tokens and cost. No foreign key: usage is recorded before the reply
-- is saved, and failed replies never are. Every other task leaves it null.
alter table public.ai_usage add column reply_id uuid;

comment on column public.ai_usage.reply_id is 'The id of the Chat reply the call produced; null for other tasks. Not a foreign key: failed replies are never saved.';

create index ai_usage_reply_id_idx on public.ai_usage (reply_id);

grant insert (reply_id) on table public.ai_usage to authenticated;
