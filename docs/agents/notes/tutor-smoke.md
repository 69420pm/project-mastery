# Tutor smoke check

Verified on 2026-10-25 on `google/gemini-3.5-flash-lite` (#182), two failing runs and one after the fixes:

- Since #205 every Chat of the check opens a staged learn session, and with due reviews it starts in the review stage. PR #205 did not run the check, and the learn eval (`evals/learn.ts`) starts every session at orient, so the review stage had no live coverage.
- The review and apply stage instructions said "ask one review question" and "ask one Problem's question" in plain words. The model read that as "write the question": it wrote the question as text, and the next turn called `grade` with an id it made up (`q_review_1`, `q_20261025_001`), which the tool refused. The prime stage, which says "ask with kind prequestion", called `ask` correctly. Naming the tool ("through ask, never as text") fixed the review stage in the next run.
- Asked for Ex. 7.2a in a new Chat, the model calls `findProblems`, then went on with the stage (review), or moved to apply with `setStage` and wrote the Exercise as text. The staged instructions now say to do what the Student asks for first, in any stage; the apply wording got the same fix as review, not yet verified live.
- A reply's steps go over the free tier's 15 requests per minute (see `ai-sdk.md`), and a 429 cut a turn short. The smoke runner now holds each Gemini API request until the last minute has room for it (`AI_SMOKE_RPM`, default 14): the next run had no 429 and finished within the 4-minute cap.
