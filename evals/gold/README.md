# Gold courses

A gold course is a Course whose Materials are AI-written, so they are safe to publish, and whose pipeline output is kept in the repo as a **snapshot**. Manual testing and smoke checks can load the snapshot instead of running the expensive pipeline (parse and Update map) again.

```
evals/gold/<slug>/
  snapshot.json.gz     the Course's built content (tables in evals/gold-snapshot.ts)
  materials/<id>.pdf   the uploaded files the snapshot's Materials point at
  pages.json           recorded page results of some pages, by file (linear-algebra-I)
  reference-map.json   the map Opus extracts in one pass, the bar for judging a run (linear-algebra-I)
  runs/<date>-<where>.json  one judged pipeline run: its map, Exercises and keys, aligned to the reference map
```

## Commands

Local database only, no model calls (`evals/smoke/gold-cli.ts`, which may use the service role).

| Command                                            | What it does                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm gold pull <slug> [course-id] [--name "…"]`   | Writes a Course from the staging project into `evals/gold/<slug>/`, reading through GET requests only (ADR 0025; needs `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SECRET_KEY`). `linear-algebra-I` needs no id.    |
| `pnpm gold export <course-id> <slug> [--name "…"]` | Writes a Course from the local database into `evals/gold/<slug>/`.                                                                                                                                                   |
| `pnpm gold seed <slug> [--exam-in-days 42]`        | Creates or reuses the gold Student (`gold@example.com`, password `gold-password`; `GOLD_EMAIL` and `GOLD_PASSWORD` override), replaces its Course of the same name and sets the Brief's exam date relative to today. |
| `pnpm gold list`                                   | Lists the snapshots.                                                                                                                                                                                                 |

## Tutoring scenarios

`evals/tutor/scenarios/` holds ten tutoring situations on `linear-algebra-I` (#277). Each file gives its setup as JSON under "## Setup" (exam days, goal, earlier Attempts, Memory, an open Question, a graded mock), the Student's persona and moves for an agent to play, and the checklist a judge scores. `evals/smoke/tutor-eval.ts` runs them, on the local database only:

| Command                                 | What it does                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm tutor-eval start <scenario>`      | A new Student with the gold course seeded and the setup applied; prints the run id (its Chat's id). `03` names `03-….md`.  |
| `pnpm tutor-eval say <run> "<message>"` | Sends the message through `respondInChat`, then prints the reply, each tool call's input and result, and the new Attempts. |
| `pnpm tutor-eval end <run>`             | Deletes the run's Student with its data.                                                                                   |

Replies run on `meta/muse-ember` and need `ALLOW_LIVE_AI=1` (docs/agents/live-ai.md); `AI_PROVIDER=mock` checks the plumbing without a model.

## Making a gold course

1. Write the Materials (lecture notes, a problem sheet with solutions, an old exam) as PDFs.
2. Run the app with a real model, sign in, create the Course, upload the Materials, fill in the Brief and wait for the map and Topics.
3. Fix what the pipeline got wrong in the app, so the snapshot is the map you want the tutor to start from.
4. `pnpm gold export <course-id> <slug>`, then commit the folder.

## What a snapshot holds

Everything the pipeline stores for a Course: Materials and their pages, chunks with embeddings, the Knowledge map, Exercises, Topics and the Brief with its exam scopes. It holds nothing a Student did (Chats, attempts, Memory, generated Problems, mock exams). A seed gives every row a new id, so it can be run again and in parallel Students. A new table with Course content must be added to `SNAPSHOT_TABLES`.

## linear-algebra-I

The gold course of the Knowledge map pipeline v2 (#222). Its `snapshot.json.gz` was pulled with `pnpm gold pull linear-algebra-I` from the staging Course `e899632d-e458-45c0-a18e-7c960ce44052` (the Opus reference map: 113 KCs, 16 Topics, 164 chunks with their embeddings), so `pnpm gold seed linear-algebra-I` loads a working Course. `materials/b585de0b-….pdf` is the unsplit 55-page script the snapshot's Material points at, downloaded from staging storage; the three PDFs below are its parts. Pull again after the staging Course changes. The folder also holds the recorded pages, the reference map and the judged runs. `pages.json` holds the recorded page results and structure call's Outline of `lecture-notes.pdf` pp. 17–24 (the end of Chapter 3 and Chapter 4, Vector Spaces) and `exercises.pdf` pp. 3 and 5 (Exercises 7–16 and solutions), which `pnpm smoke pair` and `pnpm smoke map` parse without page calls (`evals/smoke/recorded-pages.ts`); a change to the page schema records them again. The smoke checks that need a built map (`tutor`, `generate`, `mock`, `grade-mock`, `close`) seed its snapshot for their Student (`evals/smoke/gold-course.ts`) and stop with "Run the gold run first (#222)" until the snapshot exists. Its Materials are one AI-written 55-page script, split into three PDFs so that its old exams are a Material of their own. Each file keeps its part of the outline.

| File                | Pages of the script | What it holds                                                                                |
| ------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `lecture-notes.pdf` | 1–38                | Course information (admission, exam format and dates) and Chapters 1–7                       |
| `exercises.pdf`     | 39–44               | Exercises 1–25; solutions to the 11 marked (S); printed results for Exercises 7 and 17       |
| `past-exams.pdf`    | 45–55               | Final and Resit exam of winter term 2025/26, 6 problems each, each followed by its solutions |

**Judging a run.** `reference-map.json` is the Knowledge map Claude Opus 5.5 extracted from the unsplit 55-page script in one pass, with the extraction prompt's KC rule: 113 KCs (107 taught by the lecture notes, 6 only by Exercises and old exams), 204 Prerequisites, 16 Topics, the pages that teach nothing, what the script assumes from outside, and each Exercise and exam problem with the KCs it tests and its unique printed results as answer keys. Page numbers are those of the unsplit script. A run is judged against it on coverage (reference KCs matched, same or one step finer or coarser), non-KCs and duplicates, Prerequisite precision and recall, the Topic tree, Exercise tagging and answer keys. Each judged run is kept in `runs/` with its alignment (`referenceToRun` maps reference KC ids to the run's KC positions), so the next run can be compared without staging access.
