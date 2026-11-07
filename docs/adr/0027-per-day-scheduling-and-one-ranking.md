# Per-day scheduling and one ranking

> Supersedes [ADR 0019](0019-fsrs-replay.md).

**Context.** ADR 0019 replayed each KC's Attempts into an FSRS card, but which Attempts counted hung on sessions: a card waited for its first session to end, each later session's first Attempt was a Review, prequestions and Results retries never counted, and an Easy rating needed the Student's confidence and median answer time. On top sat an exam cap on due dates and a final-week sweep. Each rule was there for one kind of session, and together they made a KC's schedule hard to predict: a KC answered in an open Chat had no card, and the sweep never moved a due date under the cap. The lean rewrite (#248) has one kind of session, so the rules that told sessions apart lost their reason.

**Decision.** One per-day rule schedules every KC, on UTC days (#250).

- **The rule.** A KC's first UTC day with an Attempt teaches it: its card is created from that day's last Attempt, dated at it, and is recomputed from the newest Attempt so far during that day. On every later UTC day, the KC's first Attempt is a Review; its other Attempts that day don't schedule. Sessions play no part.
- **Ratings:** `wrong` or `solution_shown` is Again; `partial`, or `full` with some help, is Hard; `full` without help is Good. There is no Easy.
- **Retention** follows the goal as in ADR 0019: `pass` 0.85, `good_grade` 0.90, `master_everything` 0.93, none 0.90. FSRS-6 default weights, `enable_short_term: false`, `enable_fuzz: false`. There is no exam cap and no sweep.
- **No kind.** Every Attempt schedules, so `attempts.kind` goes. Nothing replaces it: a Mock exam's Attempts are those of its session, which has no Chat.
- **What replay gives** per KC: `taught` (it has a card), `learned` (a `full` Attempt without help), `recallToday`, `recallOnExamDay` (equal to `recallToday` without a future exam date), `due` (its due day is today or earlier) and `nextReview`. Today's recall is taken at the end of the current UTC day, and recall is computed on fractional days, so a KC just answered wrong does not show full recall. A KC whose newest Attempt is today and rated Again recalls just under retention today at most.
- **Pace** keeps its samples and caps but reads days, not sessions: minutes per KC from the active time of each session that holds a KC's first Attempt, minutes per Review from the first-of-day Attempts on later days.

One ranking says what is worth doing next. `rankNext` (`study/domain/ranking.ts`) is pure and read on every request, from the map, Priority, the replayed cards, the pace and the plan scope.

- **Scope.** A candidate is in scope when its Topic is in the plan or _if time allows_; a skipped Topic never is. Plan scope (goal, pins and skips) and pace are as before.
- **Value.** `Priority × (1 − recall)`, with minutes from pace: a due KC (a Review) uses `recallToday` and the minutes per Review; a Topic with untaught KCs counts 0 recall, sums over those KCs and takes the minutes per KC for each; a taught KC that is not due (a refresh) uses `recallOnExamDay` and the minutes per Review. Candidates of value 0 are dropped, except due Reviews. Ties go in Course order.
- **Order, normally:** due Reviews by value; in-plan Topics, a started one first, then pinned ones (earliest pin first), then by value per minute; refreshes by value, once no in-plan Topic has untaught KCs; then _if time allows_ Topics, ordered the same way.
- **Final stretch** (`FINAL_STRETCH_DAYS = 7`: the exam day and the 7 days before it): everything in scope ranks together by value per minute. The final mock is the Reserved exam then.
- **Anchors.** Either way a Topic never comes before an untaught Topic in scope that it builds on: the anchor moves to just before it.

`getStudyState` gives the ranking with the plan scope, Progress (in-plan KCs that are `learned`), Readiness (Priority-weighted `recallOnExamDay`, 0 untaught, per Topic and Course) and the latest graded mock score. The Student sees a KC's **recall band** instead of a state, read on its recall at the end of the current UTC day: `new`, `strong` (at or above retention), `fading` (0.7 or more) or `weak`. Phases, Today's three rules, the review queue, practice selection, KC states and Topic states are gone.

**Consequences.** A KC answered in an open Chat is scheduled at once, and its card moves with every Attempt that day, so cramming one KC in a sitting still yields one rating per day. A Mock exam's Attempt counts like a Chat's. Under UTC days, a Student who studies across UTC midnight gets a Review at near-zero elapsed time; local days wait. The `attempts` log stays the only stored learner state, and a changed goal or exam date applies on the next read. The migration deleted the prequestion and Results retry Attempts, which never scheduled and now would. Progress falls only when the plan or the map changes, never when a KC comes due. A KC answered wrong is never `strong` that day: FSRS alone would give one answered wrong late in the UTC day a recall above retention at the day's end, so a newest Attempt today rated Again caps today's recall just under retention.
