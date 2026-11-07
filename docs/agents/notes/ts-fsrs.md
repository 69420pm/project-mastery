# ts-fsrs

Verified 2026-10-24 against `ts-fsrs@5.4.2`, re-checked on 6.0.0 (the legacy `fsrs()` still runs FSRS-6), run locally without the app.

- `default_w` has 21 weights: FSRS-6.
- With the default `enable_short_term: true`, a new card rated Again, Hard or Good goes to `Learning` with a due date minutes away (1, 6 and 10 minutes), and Again on a review card goes to `Relearning` 10 minutes out. Those steps assume repeats within a sitting, which the tutor's scheduling rules (#174) exclude.
- With `enable_short_term: false`, every rating sends the card straight to `Review` with whole-day intervals, so the `Learning` and `Relearning` states never occur. From a new card at retention 0.9 without fuzz: Again 1 day (stability 0.21), Hard 2 days (1.29), Good 3 days (2.31), Easy 8 days (8.30).
- Set `enable_fuzz: false` for a replay that tests can pin: fuzz randomizes intervals.
- `f.retrievability(card, date)` returns the recall probability as a number (6.0 removed `get_retrievability` and the `<Card>` type argument of `createEmptyCard`).
- `maximum_interval` is one global number of days, so a cap that depends on the days left to an exam has to be applied to the card's due date after each review.
- A review's elapsed days are UTC calendar days between `last_review` and the review (`dateDiffInDays`), but `f.retrievability` counts whole 24-hour periods since `last_review`, so it returns 1 for the first 24 hours after any review, even one rated Again. `replay.ts` computes recall itself with the FSRS-6 curve on fractional days, `(1 + factor · t / S)^decay` with `decay = -w[20]` and `factor = 0.9^(1/decay) − 1`; it matches `f.retrievability` to 6 places at whole days (`f.retrievability` rounds to 8).
- `fsrs(...).parameters.w` gives the weights the scheduler runs on.
- Recall today is read at the end of the UTC day, so a band of an Attempt made "now" depends on the hour a test runs: an Again answered at 21:00 UTC still reads `strong` (S ≈ 0.2 days, 3 hours left), one at 00:01 reads `fading` (verified 2026-11-07). Pin a test's Attempt to a fixed time of day, or allow either band.
