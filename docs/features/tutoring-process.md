# Tutoring process

How a Chat tutors a Student from the Course's Knowledge map: what code computes on every reply, what the AI does with its four tools, and what is stored. This is the feature specified in #101, built in #102, #103, #106 and #107. Terms follow [GLOSSARY.md](../../GLOSSARY.md), and the decisions are in [ADR 0010](../adr/0010-fsrs-for-spaced-repetition.md) and [ADR 0012](../adr/0012-ai-observability-and-evals.md). The Knowledge map it reads is described in [knowledge-map-pipeline.md](knowledge-map-pipeline.md).

## Parts and when they run

| Part         | Runs                                             | Decided by                                  | Reads                                                           | Writes                                                |
| ------------ | ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Plan         | On every read: the map page and every Chat reply | Code                                        | Exam date, weekly hours, goal, KCs, Priorities, attempts        | Nothing                                               |
| Context      | Every Chat reply, before the AI's call           | Code                                        | The stored map, Priorities, Memory, Brief, attempts             | Nothing                                               |
| Opening line | A new Chat opens                                 | Code, with no model call                    | The map and the KC states                                       | Nothing                                               |
| Reply        | Each message from the Student                    | The AI, with four tools and at most 5 steps | KC sources and Exercises, through `readKcs` and `findExercises` | `attempts` (`recordAttempt`), `memories` (`remember`) |

The review ladder is not a part of its own: code replays it from the attempts on every read, and it sets the KC states and the due reviews.

## Context on every reply

`startTutoring` (`src/features/study/server/tutoring.ts`) reads the stored map, the Priorities, the Memory, the Brief's exam facts and the attempts, as the Student. It builds the tutor context and the tools, and the instructions (`src/features/study/ai/instructions.ts`) are written from the context on every reply, in this order:

1. The role, three rules, the tutoring guidance, the Memory guidance, the scope and the format. The rules are: never give a solution before the Student has tried; every activity asks the Student to produce something; claims about the course cite the Material and page.
2. Today's date, the exam date, and the Memory in full when there is one.
3. The plan: the Phase, the goal, the guidance for the Phase, and the share of relevant KCs that fit the weekly hours.
4. The due reviews, when the Course has a map.
5. The candidates, grouped by big idea with their anchors. Without a map, a note says so and points to the map page.

### Plan (#106)

`planStudy` (`src/features/study/domain/plan.ts`) is pure code on UTC days. A relevant KC is one that is not prior knowledge and has a Priority above 0, or no Priority yet.

- **Phase.** _Final week_ when the exam is within 7 days. _Deepen_ when every relevant KC is taught. _Build_ otherwise, including before the map is built. There is no Phase without an exam date, or after it has passed.
- **Pacing.** Only with weekly hours and outside the final week. The hours until the final week are the weekly hours times (days left − 7) ÷ 7. At a fixed 30 minutes per KC, that many untaught relevant KCs fit, highest Priority first and then by name. The share is the taught and fitting KCs as a whole percent of the relevant ones, and the rest are left out.
- **Where it shows.** The map page's plan line, with a "won't fit" badge on each left-out KC. The AI gets the same figures as one line, and mentions them only when the Student asks about time.
- **Goal.** "to pass", "a good grade" or "to master everything" tells the AI how to weigh breadth against depth. It moves no KC.

### Due reviews and candidates

- **Due reviews** (`src/features/study/domain/reviews.ts`): the taught KCs whose next review is today or earlier, ranked by Priority × (days overdue + 1), with ties to the longer overdue and then map order. A KC without a Priority counts as 0 but is still listed. The AI sees at most 8, and a count of the rest.
- **Candidates** (`src/features/study/domain/candidates.ts`): up to 10 KCs that are new (neither prior knowledge nor taught), have a Priority above 0 or none, and whose Prerequisites are all prior knowledge or taught. They are ranked by Priority, KCs without one last, then grouped by big idea, and each carries its anchors (its Prerequisites).

The map stores no topics. The AI picks a connected handful from the candidates, so the map can update without its groups going stale.

## The AI's reply

A reply streams one call with the `chat` task's model for the Student's choice, with the instructions and the tools, and at most 5 steps (`MAX_STEPS` in `src/features/chat/server/handler.ts`). The Daily limit is checked before the model is called. The tool calls are stored with the reply, and the Chat shows each as a collapsed step card in reply order, with a one-line summary written by code. Each reply also stores the tutor context it was given (`chat_messages.tutor_context`), which the reply's Context sheet shows with the instructions re-rendered by today's code.

| Tool            | Takes                                                                                               | Gives back                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readKcs`       | 1 to 8 KC ids                                                                                       | Each KC's name, type and description, and up to 3 source chunks: Material, pages, a link to the chunk on its page, and its Markdown                                                                                                                                          |
| `findExercises` | 1 to 8 KC ids                                                                                       | Up to 3 Exercises that test any of them and the Student has no attempt on: question, link, KCs and solution with its status. Old-exam ones come first, then those testing more of the KCs, then the easier ones. With none left, a note tells the AI to pose its own problem |
| `recordAttempt` | An optional Exercise id, `help` (`none`, `some` or `solution_shown`), and 1 to 8 KCs with `correct` | Each KC's new level and next review date                                                                                                                                                                                                                                     |
| `remember`      | One line of up to 300 characters, without line breaks                                               | `ok`, or a refusal when the Memory is full                                                                                                                                                                                                                                   |

A solution's status says where it comes from: `from the Materials`, `verified` when an AI solution agrees, `disputed` when one disagrees (the AI must check it before relying on it), or `generated` when the Materials have none. A refused call, such as an id that is not of the Course, a KC listed twice or a full Memory, throws a `TutorToolError`. The model reads its message and the reply goes on.

The guidance is prompt text, not code. The AI starts with due reviews, then picks a handful of candidates, then docks, frames, builds, applies and connects. It fades its scaffolds, gives feedback on the reasoning, varies its openings, and never shows the Student ids or tool names. It never poses two problems of the same task type in a row, and it keeps an Exercise's solution back until the Student has tried.

## Evidence and the review ladder (#103)

`recordAttempt` inserts, as the Student, one `attempts` row per KC in one statement, so the evidence is all or nothing. The database refuses a KC or Exercise that is not of the Course.

`replayLadder` (`src/features/study/domain/ladder.ts`) replays a KC's attempts in time order, on UTC days:

- The first attempt teaches the KC at level 1, due the next day, whatever its outcome.
- On or after the due day, a correct attempt without help climbs a level (up to 5), one with help keeps its level, and a wrong one or one with the solution shown drops it to level 1, due the next day.
- Before the due day, a wrong attempt drops it to level 1 and correct ones change nothing. Cramming earns no levels.
- The intervals for levels 1 to 5 are 1, 3, 7, 14 and 30 days. With an exam after the day, an interval is at most a quarter of the days left, rounded down, and at least 1 day. It is computed on read, so a changed exam date applies at once.

`kcState` gives each KC's state: _new_ (no attempts), _due_ (next review today or earlier), _mastered_ (level 2 or more, not due) or _learning_ (level 1, not due). The map page shows each KC's state and the number of reviews due.

`openingLine` (`src/features/study/domain/opening.ts`) writes a new Chat's empty state from code, with no model call. Without a map it asks the Student to build one. With no review due it says nothing is due. Otherwise it says how many reviews are due, then something new.

## Memory (#107)

The Memory is one text per Course in `memories`, at most 4,000 characters, created on its first write.

- **The AI** adds a dated line through `remember`, which calls `append_memory`. That is one statement, so concurrent lines keep each other. At the limit the call is refused.
- **The Student** edits the whole text on the Brief page (`src/features/study/components/memory-card.tsx`). Saving replaces it, and empty text clears it. A save overwrites any line the AI added after the page loaded.
- **Use.** The full text goes into the instructions on every reply. The Brief's own AI does not read it.
- **Rules.** The Memory holds what helps tutoring, never mastery, which the attempts hold. When a note and the Student's answers disagree, the answers win. Notes never set KC states, since the ladder reads only attempts.

## Daily limit

Every reply checks the Student's Daily limit first and is refused with 429 at the limit. The opening line makes no call. Each reply records its usage under the task `chat`, linked to its Chat. A stopped reply has no reported usage, so its cost is estimated from the text, and stopping does not get around the limit.

## Tables

- **Student state:** `attempts` (owner, Course, KC, optional Exercise, `correct`, `help`, `created_at`), insert-only for the Student and with Row Level Security that requires the KC and the Exercise to be of the Course. `memories` (one row per Course, owner, `text`, `updated_at`).
- **Read:** `briefs` (exam date, weekly hours, goal), `kc_priorities`, the map tables (`kcs`, `kc_sources`, `prerequisite_links`, `exercises`, `exercise_kcs`), `chunks` and `exercise_solutions`.
- **Written elsewhere:** `ai_usage`. The `append_memory` function (`security invoker`) writes the Memory line.

Migrations: `20261016100000_create_attempts.sql`, `20261016110000_create_memories.sql` and `20261016120000_create_append_memory.sql`.

## Where to change things

- **Code:** `src/features/study/`. The prompt is in `ai/instructions.ts`, the tool schemas and descriptions in `ai/tools.ts`, the context and tool actions in `server/tutoring.ts`, the storage in `server/`, and the pure rules in `domain/`, with tests beside them.
- **Reply loop:** `src/features/chat/server/handler.ts` (steps, Daily limit, usage) and `src/features/chat/ai/reply.ts` (the instructions and the model settings).
- **UI:** the plan line, the "won't fit" badge and the state badges in `src/features/knowledge-map/components/` (`study-plan.tsx`, `kc-priority.tsx`, `knowledge-map.tsx`); the Memory card on the Brief page in `src/features/study/components/memory-card.tsx`.
- **Model:** the `chat` task in `AI_TASKS` in `src/lib/ai/models.ts`.
- **Prompt changes:** run the `chat` eval, as ADR 0012 and [live-ai.md](../agents/live-ai.md) describe.

## Checks

- `pnpm test:run` covers the pure rules (ladder, candidates, reviews, plan, Exercises, opening line), the Memory save action, and the Chat handler tests (`handler.tutor`, `handler.attempts`, `handler.memory`). The handler tests run replies in-process, with mock models and a fake Supabase.
- `pnpm db:test` covers the policies, grants and cascades of `attempts` and `memories`, and `append_memory` (`attempts.test.sql`, `memories.test.sql`).
- `pnpm test:e2e` covers `e2e/memory.spec.ts`, the Memory on the Brief page.
- `pnpm smoke tutor` runs one real exchange through the Chat handler on the jet-engines gold map, with stand-in sources and two KCs due. It sends a greeting, a plausible answer and a learning preference, then checks that the first reply reads a due KC and ends with a question, that the answer records an attempt on a KC of the Course, that the preference adds a Memory line, and that no ids or tool names appear in the text. It calls a live model, so [live-ai.md](../agents/live-ai.md) applies.

## Not built

From the deferred items of #101 and its build order:

- Generated problems, a math or code tool for checking answers, and the problem store (milestone 2).
- Session flags, the constraint log and the weekly reading routine (milestone 6).
- The pilot items (milestone 7): reserving an old exam for the final week, a guarantee that every high-priority KC gets a review in the final week (the final-week guidance asks only for mixed review), and asking for grades.
- Plan: personal pace (time is not measured, and every KC takes a fixed 30 minutes), goal handling beyond the AI's context, move, pin and skip controls, an "if time allows" group, and an AI summary of the plan.
- Memory: topic notes, session notes, consolidation, a trigger for ending a Chat, and pinned instructions. The Student edits the whole text, not single notes.
- Guidance from #101 that the instructions do not yet give: active recall every two or three KCs, asking for confidence before a reveal, probing known misconceptions, asking why a step works after a correct answer, saying so when help is used without an attempt, and steering difficulty beyond fading scaffolds. Interleaving easily confused KCs (the `contrasts_with` links in #101) is also not built.
- Stored topics, a mastery number, FSRS ([ADR 0010](../adr/0010-fsrs-for-spaced-repetition.md)), a map of a group after a session, and photos of handwritten work, which #101 leaves untested.

The open decisions of #101 stay open: what ends a Chat for notes and consolidation, whether the plan needs stored topics, how pacing measures time, and how handwritten work is submitted and read.
