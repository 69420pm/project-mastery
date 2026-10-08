-- A stopped reply is saved when its aborted stream ends, which can be after
-- the Student has already regenerated it or sent their next message. Each
-- request marks the reply it will write as the Chat's latest, and a reply
-- that is no longer the latest when it is saved is not kept, so a turn never
-- ends up with two replies.

alter table public.chats
add column latest_reply_id uuid;

comment on column public.chats.latest_reply_id is 'The id of the AI reply the latest request writes. Other replies that end later are stale and not kept.';

grant update (latest_reply_id) on table public.chats to authenticated;
