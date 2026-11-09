# Tutor smoke check

Verified from 2026-10-25 on `google/gemini-3.5-flash-lite` (#182, #184), over several runs:

- Instructions that say "ask one question" in plain words read to the model as "write the question": it wrote the question as text, and the next turn called `grade` with an id it made up (`q_review_1`, `dummy_id`), which the tool refused. Naming the tool ("through ask, never as text") fixed the next run, but not every run: on `gemini-3.5-flash-lite` one run is no verdict on a wording.
- Since #251 the instructions are static and the facts come in a `<tutor-context>` block before the newest Student message, so a run no longer checks that a reply reads a KC before its first text: the model may propose first. The check asks for a reply, a question on a due KC, one Attempt per KC from the answer, the key check, a Memory line, a Reading section and no ids or tool names. How well it tutors is judged by hand.
- Asked for an Exercise by name, the model called `findProblems` and then wrote the Exercise as text. The `findProblems` description says to pose the picked Problem through ask with its problemId.
- A reply's steps go over the free tier's 15 requests per minute (see `ai-sdk.md`), and a 429 cut a turn short. The smoke runner holds each Gemini API request until the last minute has room for it (`AI_SMOKE_RPM`, default 14).
- Runs back to back use up the Gemini free tier's 500 requests per day; the next run gets a 429 with "Please retry in 10h".
- On `xiaomi/mimo-v2.6-flash` the model often graded an answer in its text ("Grading of card #3: partial") without calling `grade`, which left the question open.
