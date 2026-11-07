-- The per-day rule (#250): every Attempt schedules its KC, so `attempts.kind`
-- goes. Attempts that never scheduled (prequestions and Results session
-- retries) would now schedule, so they go.

delete from public.attempts where kind in ('pre', 'retry');

alter table public.attempts drop column kind;

comment on table public.attempts is
  'The graded evidence for one KC from one question. Immutable; replayed into the KC''s FSRS card by the per-day rule.';
