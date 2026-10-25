# Tutoring process

How a Chat tutors a Student from the Course's Knowledge map: what code computes on every reply, what the AI does with its tools, and what is stored. This is the feature specified in #101, built in #102, #103, #106 and #107. Terms follow [GLOSSARY.md](../../GLOSSARY.md), and the decisions are in [ADR 0010](../adr/0010-fsrs-for-spaced-repetition.md) and [ADR 0012](../adr/0012-ai-observability-and-evals.md). The Knowledge map it reads is described in [knowledge-map-pipeline.md](knowledge-map-pipeline.md).

## Parts and when they run

| Part       | Runs                                             | Decided by                                 | Reads                                                            | Writes                  |
| ---------- | ------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------- | ----------------------- |
| Plan       | On every read: the map page and every Chat reply | Code                                       | Exam date, weekly hours, goal, KCs, Priorities, attempts         | Nothing                 |
| Context    | Every Chat reply, before the AI's call           | Code                                       | The stored map, Priorities, Memory, Brief, attempts              | Nothing                 |
| Today card | The map page and a new Chat open                 | Code, with no model call                   | The plan and the due reviews                                     | Nothing                 |
| Reply      | Each message from the Student                    | The AI, with its tools and at most 5 steps | KC sources and Exercises, through `getTopic` and `findExercises` | `memories` (`remember`) |

FSRS scheduling is not a part of its own: code replays each KC's card from the attempts on every read, and it sets the KC states and the due reviews.

## Context on every reply

`startTutoring` (`src/features/study/server/tutoring.ts`) reads the stored map, the Priorities, the Memory, the Brief's exam facts and the attempts, as the Student. It builds the tutor context and the tools, and the instructions (`src/features/study/ai/instructions.ts`) are written from the context on every reply, in this order:

1. The role, three rules, the tutoring guidance, the Memory guidance, the scope and the format. The rules are: never give a solution before the Student has tried; every activity asks the Student to produce something; claims about the course cite the Material and page.
2. Today's date, the exam date, and the Memory in full when there is one.
3. The plan: the Phase, the goal, the guidance for the Phase, the Today card's hint and the fit line.
4. The due reviews, when the Course has a map.
5. The Today card's next Topic: its name and central question, its KCs in teaching order, each marked taught or not, and its anchors with their ids. Without a map, a note says so and points to the map page.

### Plan over Topics (#177)

`planStudy` (`src/features/study/domain/plan.ts`) is pure code on UTC days over the stored Topics. A Topic's priority is the sum of its KCs' Priorities, a missing one counting as 0.

- **Topics in the plan.** _To pass_ takes Topics by priority until their sum reaches 80% of the total, the crossing Topic included. _A good grade_ and no goal take every Topic with priority above 0, _to master everything_ every Topic. Before any Priority, every Topic is in. The rest are _if time allows_. A pin always adds a Topic and a skip always removes it.
- **Phase.** _Final week_ when the exam is within 7 days. _Deepen_ when every in-plan Topic is learned, solid or needs work. _Build_ otherwise. There is no Phase without an exam date, or after it has passed.
- **Order.** The in-plan Topics that are new or in progress: pinned first, then in progress, then by priority per estimated minute, ties in Course order. A Topic never comes before one that reaches it over the Topic arrows, unless both are on a cycle.
- **Fit.** Only with weekly hours and outside the final week. The budget is the weekly hours times the days until the final week ÷ 7, minus the review minutes of the existing cards, each reviewed Good through the replay's scheduler and exam cap until the final week (`forecastReviews`). Each Topic in order costs its untaught KCs × (minutes per KC + a fresh card's review minutes); from the first that doesn't fit, none fits. The pace is a fixed 30 minutes per KC and 2 per review until it is measured.
- **Where it shows.** The fit line on the map ("Build phase. At your pace, 9 of 12 Topics fit, covering 84% of exam weight.") and in the Brief with the Topics that won't fit, and the badges _pinned_, _skipped_, _won't fit_ and _if time allows_ on the cards and the Topic page. The AI gets the fit line, and mentions it only when the Student asks about time.

### Due reviews and the Today card

- **Due reviews** (`src/features/study/domain/reviews.ts`): the taught KCs whose next review is today or earlier, ranked by Priority × (1 − today's recall), ties in map order. A KC without a Priority counts as 0 but is still listed. The AI sees at most 8, and a count of the rest.
- **Today card** (`planToday` in `src/features/study/domain/today.ts`, `TodayCard` in `components/today-card.tsx`): the due reviews with their minutes at the measured pace, then the next Topic. In build and without an exam date it is the first of the plan order. In Deepen it is the needs-work Topic with the lowest recall, otherwise the learned one, otherwise the solid one. In the final week it is the taught Topic with the highest priority × (1 − mean recall projected to the exam), and no new Topic. Deepen adds the hint "Practice exam-style problems", the final week "Try an old exam under exam conditions". The card sits at the top of the Course map, with Start opening a new Chat, and in a new Chat's empty state, without Start. Without a map or Topics it says to build or update the map.

## The AI's reply

A reply streams one call with the `chat` task's model, with the instructions and the tools, and at most 5 steps (`MAX_STEPS` in `src/features/chat/server/handler.ts`). The Daily limit is checked before the model is called. The tool calls are stored with the reply, and the Chat shows each as a collapsed step card in reply order, with a one-line summary written by code. Each reply also stores the tutor context it was given (`chat_messages.tutor_context`), which the reply's Context sheet shows with the instructions re-rendered by today's code.

| Tool            | Takes                                                 | Gives back                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getTopic`      | A Topic id, and optionally up to 12 of its KC ids     | The central question, the KCs in order with type, description and state, the anchors with their state, and the Reading sections with done marks. The given KCs (all when none) come with up to 3 source chunks: Material, pages, a link to the chunk on its page, and its Markdown          |
| `findExercises` | 1 to 8 KC ids                                         | Up to 3 Exercises that test any of them and the Student has not been asked as a question: question, link, KCs and solution with its status. Old-exam ones come first, then those testing more of the KCs, then the easier ones. With none left, a note tells the AI to pose its own problem |
| `remember`      | One line of up to 300 characters, without line breaks | `ok`, or a refusal when the Memory is full                                                                                                                                                                                                                                                  |
| `setStage`      | A stage, and optionally a one-line reason             | The stage moved to, or a refusal: a move backwards (other than `work` → `read` while a Reading section has no Done), out of `close`, or a forward move other than the next stage (or, from `review`, the stage the context named) without a reason                                          |

A solution's status says where it comes from: `from the Materials`, `verified` when an AI solution agrees, `disputed` when one disagrees (the AI must check it before relying on it), or `generated` when the Materials have none. A refused call, such as an id that is not of the Course, a KC listed twice or a full Memory, throws a `TutorToolError`. The model reads its message and the reply goes on.

The guidance is prompt text, not code. In a session with a Topic, one block per Stage gives its purpose, when to skip it and how to teach in it (see below). In a session without a Topic, the AI starts with due reviews, then teaches what comes next: it docks, frames, builds, applies and connects. It fades its scaffolds, gives feedback on the reasoning, varies its openings, and never shows the Student ids or tool names. It never poses two problems of the same task type in a row, and it keeps an Exercise's solution back until the Student has tried.

## Learn session Stages (#180)

A learn session teaches one Topic in Stages: review, orient, prime, read, work, apply, rebuild, close.

- **Session Topic.** The session's first reply sets `study_sessions.topic_id` to the plan's next Topic, through `start_study_session_topic`, and it stays fixed. A Course without Topics, or a plan with no next Topic, gives a session without a Topic or stage.
- **Start stage** (`startStage` in `src/features/study/domain/stages.ts`): `review` when reviews are due, else the stage the Topic's most recent earlier session stopped at when that is before `close` (a stop at `review` restarts at `orient`), else `orient`. At `review` the context names the stage to go to after the reviews, lists the Topic's anchors first among the due reviews and gives the minutes since the session started; the review opening lasts at most 10 minutes.
- **Moving on.** `setStage` (`stageMoveRefusal`) writes through `set_study_session_stage`, which changes only the caller's running session with a Topic, never past `close`.
- **Rebuild.** One `ask` of kind `rebuild` over all the Topic's KCs (`ask` takes up to 12 KC ids). Its grade is followed by a Knowledge map card that opens the Topic's part of the Knowledge map, with KC states, in the source pane (`getTopicKnowledgeMap`); while the reply streams it opens on its own. The pane shows one thing at a time.
- **Stage bar** (`src/features/study/components/stage-bar.tsx`): above the messages, the eight stages with the current one marked and the earlier ones done; below `lg` only the current one. The Chat reads the stage from the stored tutor context and the `setStage` results.
- **Close card** (`src/features/study/components/close-card.tsx`): it replaces the composer at `close` or once the session has ended. `getSessionSummary` gives the Topic's new state and each KC with attempts in the session with its state and next review, as if the session had ended. `rateStudySession` saves the Session rating, 1 to 5 with an optional note of at most 300 characters (`rating`, `rating_note`), and ends a running session. A Student may update only these and `ended_at`, on their own session.
- **Checks:** `pnpm evals learn` (`evals/learn.ts`, live) runs two scripted sessions on the jet-engines gold course's first Topic with the real instructions and tools and in-memory actions, as `pnpm evals grade` does. A scripted Student answers each `ask` from a fixed answer per stage and kind, labelled per KC, and presses Done after each `showReading`; one is mostly right, the other has planted errors. Code checks the stage order, KC ids on every `ask`, the grades against the labels, no Exercise final value before the attempt, no ids or tool names in the text, at least 2 KCs per Work question on average, and reaching `close`. The gate is that both sessions pass, in at most 60 model calls.

## Evidence and FSRS replay (#103, #174)

Every Chat is a Study session: the database starts a `learn` session (`study_sessions`) with each new Chat, and a deleted Chat leaves its session. Each attempt (`attempts`) is the grade of one Question (`questions`, with its KCs in `question_kcs`) on one of its KCs: `full`, `partial` or `wrong`, with the help given and, for a numeric final answer, how it compared with the Exercise's key. The database refuses an attempt on a KC its question does not test. A Course's attempts are read through their sessions ([ADR 0018](../adr/0018-questions-as-first-class-objects.md)).

`replayCourse` (`src/features/study/domain/replay.ts`) replays each KC's attempts into an FSRS card with `ts-fsrs`, on UTC days, as [ADR 0019](../adr/0019-fsrs-replay.md) records:

- Wrong or with the solution shown rates Again, partial or with some help Hard, full without help Good. The desired retention follows the Brief's goal.
- Prequestion attempts never schedule. The KC's first session with another attempt creates its card once the session has ended, rated by the last attempt there. Each later session reviews it once, with its first attempt.
- A session ends with `ended_at`, or 2 hours after its Chat's newest message.
- With an exam after a review's day, the due date is at most half the days left away, and the final-week sweep brings the top half of the KCs by Priority due 3 days before the exam.

`kcState` gives each KC's state: _new_ (no attempts besides prequestions), _learning_ (first session still open, or stability under 7 days and not due), _due_ (next review today or earlier) or _known_, with its next review and today's recall. The map page shows each KC's state, recall and next review, and the number of reviews due.

## Memory (#107)

The Memory is one text per Course in `memories`, at most 4,000 characters, created on its first write.

- **The AI** adds a dated line through `remember`, which calls `append_memory`. That is one statement, so concurrent lines keep each other. At the limit the call is refused.
- **The Student** edits the whole text on the Brief page (`src/features/study/components/memory-card.tsx`). Saving replaces it, and empty text clears it. A save overwrites any line the AI added after the page loaded.
- **Use.** The full text goes into the instructions on every reply. The Brief's own AI does not read it.
- **Rules.** The Memory holds what helps tutoring, never mastery, which the attempts hold. When a note and the Student's answers disagree, the answers win. Notes never set KC states, since the replay reads only attempts.

## Daily limit

Every reply checks the Student's Daily limit first and is refused with 429 at the limit. The Today card makes no call. Each reply records its usage under the task `chat`, linked to its Chat. A stopped reply has no reported usage, so its cost is estimated from the text, and stopping does not get around the limit.

## Tables

- **Student state:** `attempts` (owner, Course, KC, optional Exercise, `correct`, `help`, `created_at`), insert-only for the Student and with Row Level Security that requires the KC and the Exercise to be of the Course. `memories` (one row per Course, owner, `text`, `updated_at`). `topic_choices` (owner, Topic, `choice` pinned or skipped, `created_at`, one row per Topic), which the Student reads, writes and deletes only for Topics of their own Courses; the owner is set by the database and only `topic_id`, `choice` and `created_at` are granted for insert and update.
- **Read:** `briefs` (exam date, weekly hours, goal), `kc_priorities`, the map tables (`kcs`, `kc_sources`, `prerequisite_links`, `exercises`, `exercise_kcs`, `topics`), `chunks`, `exercise_solutions`, and for the measured pace `study_sessions`, `questions` and `chat_messages`.
- **Written elsewhere:** `ai_usage`. The `append_memory` function (`security invoker`) writes the Memory line.

Migrations: `20261016100000_create_attempts.sql`, `20261016110000_create_memories.sql` and `20261016120000_create_append_memory.sql` and `20261024140000_create_topic_choices.sql`.

## Where to change things

- **Code:** `src/features/study/`. The prompt is in `ai/instructions.ts`, the tool schemas and descriptions in `ai/tools.ts`, the context and tool actions in `server/tutoring.ts`, the storage in `server/`, and the pure rules in `domain/`, with tests beside them.
- **Reply loop:** `src/features/chat/server/handler.ts` (steps, Daily limit, usage) and `src/features/chat/ai/reply.ts` (the instructions and the model settings).
- **UI:** in `src/features/study/components/`: the fit line and the Topics that won't fit (`study-plan.tsx`), the Today card (`today-card.tsx`), Pin and Skip on the Topic page (`topic-choice-controls.tsx`, calling the `setTopicChoice` Server Action in `server/actions.ts`) and the Memory card on the Brief page (`memory-card.tsx`).
- **Model:** the `chat` task in `AI_TASKS` in `src/lib/ai/models.ts`.
- **Prompt changes:** run the `chat` eval, as ADR 0012 and [live-ai.md](../agents/live-ai.md) describe.

## Checks

- `pnpm test:run` covers the pure rules (FSRS replay, reviews, plan, pace, the Today card, Exercises), the Memory save action, and the Chat handler tests (`handler.tutor`, `handler.attempts`, `handler.memory`). The handler tests run replies in-process, with mock models and a fake Supabase.
- `pnpm db:test` covers the policies, grants and cascades of `attempts`, `memories` and `topic_choices`, and `append_memory` (`attempts.test.sql`, `memories.test.sql`, `topic_choices.test.sql`).
- `pnpm test:e2e` covers `e2e/memory.spec.ts`, the Memory on the Brief page.
- `pnpm smoke tutor` runs real exchanges through the Chat handler on the jet-engines gold map with one Topic per Big idea and stand-in sources. Before anything is taught, a greeting must read the next Topic's KCs before any text. Then, with two KCs due, it sends a greeting, a plausible answer and a learning preference, and checks that the first reply reads a due KC and ends with a question, that every KC id the AI uses comes from its context or a tool's result, that the answer records an attempt on a KC of the Course, that the preference adds a Memory line, and that no ids or tool names appear in the text. It calls a live model, so [live-ai.md](../agents/live-ai.md) applies.

## Not built

From the deferred items of #101 and its build order:

- Generated problems, a math or code tool for checking answers, and the problem store (milestone 2).
- Session flags, the constraint log and the weekly reading routine (milestone 6).
- The pilot items (milestone 7): reserving an old exam for the final week, a guarantee that every high-priority KC gets a review in the final week (the final-week guidance asks only for mixed review), and asking for grades.
- Plan: moving a Topic by hand, an AI summary of the plan, reading time in active time (M4), and starting a Chat on a chosen Topic (M4).
- Memory: topic notes, session notes, consolidation, a trigger for ending a Chat, and pinned instructions. The Student edits the whole text, not single notes.
- Guidance from #101 that the instructions do not yet give: active recall every two or three KCs, asking for confidence before a reveal, probing known misconceptions, asking why a step works after a correct answer, saying so when help is used without an attempt, and steering difficulty beyond fading scaffolds. Interleaving easily confused KCs (the `contrasts_with` links in #101) is also not built.
- A mastery number, FSRS ([ADR 0010](../adr/0010-fsrs-for-spaced-repetition.md)), a map of a group after a session, and photos of handwritten work, which #101 leaves untested.

The open decisions of #101 stay open: what ends a Chat for notes and consolidation, and how handwritten work is submitted and read.
