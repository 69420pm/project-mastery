# FSRS replay

**Context.** ADR 0010 scheduled reviews on a fixed review ladder until FSRS could be fitted to a Student's history. The ladder ignored how well a KC was answered beyond correct or not, and its levels said nothing about how likely the Student is to remember a KC today, which ranking due reviews and later the exam projection need. FSRS-6's default weights are a better start than a fixed ladder even unfitted, and M1 (#173, ADR 0018) gave every attempt a session, a result and the help given, which is what a rating needs.

**Decision.** FSRS (`ts-fsrs` 5.4.2) replaces the ladder (#174). A pure module (`src/features/study/domain/replay.ts`) replays each KC's attempts into an FSRS card on every read, with the FSRS-6 default weights, `enable_short_term: false` and `enable_fuzz: false`; nothing derived is stored, and the `attempts` log stays the only stored learner state.

- **Retention** comes from the Brief's goal: `pass` 0.85, `good_grade` 0.90, `master_everything` 0.93, none 0.90.
- **Ratings:** wrong or `solution_shown` is Again; partial, or full with `some` help, is Hard; full without help is Good. Easy needs the Student's confidence and their median answer time (#174, slice 3).
- **What schedules:** `pre` attempts never do. A KC's first session with another attempt creates its card once that session has ended, rated by the KC's last attempt there and dated at it. In each later session only the KC's first attempt is a review.
- **Session end:** `study_sessions.ended_at`, or else the Chat's newest message once it is more than 2 hours old, computed on read.
- **Exam cap:** with the exam after a review's day, its due date is at most `max(1, floor(days left / 2))` days after it.
- **Final-week sweep:** with an exam date not yet passed, the top half (rounded up) by Priority of the Course's KCs with a card whose last review is more than 7 days before `examDate − 3` become due on `examDate − 3` at the latest.
- **States:** `new` (no non-`pre` attempt), `learning` (first session still open, or stability under 7 days and not due), `due` (the card's due UTC day is today or earlier), else `known`. Due reviews rank by Priority × (1 − today's recall).

Short-term steps are off because they schedule repeats minutes apart, inside one sitting. The tutor relearns a wrong answer right away in the Chat (the instructions' relearn rule), and those same-session attempts are exactly what the rules above keep from scheduling: counting them would let a Student cram a KC to a long interval in one sitting. Whole-day intervals also match the UTC days the rest of the study plan runs on.

**Consequences.** A changed exam date, goal or rule applies on the next read, and tests pin replays to literal due dates and stabilities, since nothing is random. Replay reads the Course's attempts and its sessions' end on every read; a cache (`kc_fsrs_cache`) waits until a Course has about 5,000 attempts. Fitting personal FSRS weights waits for about 1,000 reviews. Since replay caps every review with today's exam date, a review more than 10 days before the exam is due at least 5 days before it, so the sweep moves no due date under the current cap; it holds the final-week rule should the cap loosen. The KC panel, the due reviews and the `grade` result show today's recall and the next review instead of a level.
