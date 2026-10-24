# ts-fsrs

Verified 2026-10-24 against `ts-fsrs@5.4.2` (latest stable; 6.0 is still beta), run locally without the app.

- `default_w` has 21 weights: FSRS-6.
- With the default `enable_short_term: true`, a new card rated Again, Hard or Good goes to `Learning` with a due date minutes away (1, 6 and 10 minutes), and Again on a review card goes to `Relearning` 10 minutes out. Those steps assume repeats within a sitting, which the tutor's scheduling rules (#174) exclude.
- With `enable_short_term: false`, every rating sends the card straight to `Review` with whole-day intervals, so the `Learning` and `Relearning` states never occur. From a new card at retention 0.9 without fuzz: Again 1 day (stability 0.21), Hard 2 days (1.29), Good 3 days (2.31), Easy 8 days (8.30).
- Set `enable_fuzz: false` for a replay that tests can pin: fuzz randomizes intervals.
- `f.get_retrievability(card, date, false)` returns the recall probability as a number; with `true` (the default) it returns a formatted percent string.
- `maximum_interval` is one global number of days, so a cap that depends on the days left to an exam has to be applied to the card's due date after each review.
- A review's elapsed days are UTC calendar days between `last_review` and the review (`dateDiffInDays`), but `get_retrievability` counts whole 24-hour periods since `last_review`. Overwriting `card.due` (the exam cap, the sweep) changes neither.
