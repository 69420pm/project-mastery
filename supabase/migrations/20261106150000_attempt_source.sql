-- The per-day rule (#250): every Attempt schedules its KC, so `attempts.kind`
-- goes. `attempts.source` says where an Attempt was made, `chat` or `mock`,
-- and is read only for analytics. Attempts that never scheduled
-- (prequestions and Results session retries) would now schedule, so they go.

delete from public.attempts where kind in ('pre', 'retry');

alter table public.attempts
  add column source text not null default 'chat'
    check (source in ('chat', 'mock'));

update public.attempts set source = 'mock' where kind = 'mock';

alter table public.attempts drop column kind;

comment on column public.attempts.source is
  'Where the Attempt was made: chat, or mock for a Mock exam''s item, written by its grading. Read only for analytics.';

comment on table public.attempts is
  'The graded evidence for one KC from one question. Immutable; replayed into the KC''s FSRS card by the per-day rule.';
