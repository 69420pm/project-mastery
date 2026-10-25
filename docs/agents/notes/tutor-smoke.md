# Tutor smoke check

Verified on 2026-10-25, two live runs on `google/gemini-3.5-flash-lite` (#182):

- Since #205 every Chat of the check opens a staged learn session, and with due reviews it starts in the review stage. PR #205 did not run the check.
- In the review stage the first reply writes the review question as text instead of calling `ask`, and the next turn calls `grade` with an id it made up (`q_review_1`, `placeholder`). In the same runs the prime and work stages called `ask` correctly.
- The Exercise request turn (`Ex. 7.2a`) runs in a new Chat that is still in the review stage: in one run the model called `findProblems` (it returned Ex. 7.2b and Ex. 7.2a) but then moved to review; in the other it ran the reviews first and never looked for the Exercise.
- The check's multi-step turns go over the Gemini free tier's 15 requests per minute (see `ai-sdk.md`): a 429 cut one turn short in both runs.
