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

Local database only, except `demo`; no model calls (`evals/smoke/gold-cli.ts`, which may use the service role).

| Command                                                  | What it does                                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm gold export <course-id> <slug> [--name "…"]`       | Writes a Course from the local database into `evals/gold/<slug>/`.                                                                                                                                                   |
| `pnpm gold seed <slug> [--exam-in-days 42]`              | Creates or reuses the gold Student (`gold@example.com`, password `gold-password`; `GOLD_EMAIL` and `GOLD_PASSWORD` override), replaces its Course of the same name and sets the Brief's exam date relative to today. |
| `pnpm gold demo <staging-course-id> [--exam-in-days 42]` | Copies a staging Course with its Chats and attempts into the demo account (below).                                                                                                                                   |
| `pnpm gold list`                                         | Lists the snapshots.                                                                                                                                                                                                 |

## The demo account

`/demo` signs a visitor into a shared demo account (`DEMO_EMAIL`, `DEMO_PASSWORD` on the deployment; unset, it is a 404) and opens its latest Course's map, so a recruiter sees the app without signing up. Visitors share the account and its Daily limit, which caps what they spend.

To fill it, build the Course on staging (upload, Brief, a Chat or two), then run with the target project's keys in the shell, not in `.env.local`:

```bash
DEMO_SUPABASE_URL=https://<ref>.supabase.co DEMO_SUPABASE_SECRET_KEY=sb_secret_... \
DEMO_EMAIL=demo@... DEMO_PASSWORD=... pnpm gold demo <staging-course-id>
```

It reads staging with `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SECRET_KEY` and writes nothing there. On the target it creates the account (or resets its password), deletes all of its Courses and stores the copy: the snapshot tables plus `ACTIVITY_TABLES` (`evals/gold-snapshot.ts`), without AI usage. Run it again to reset the demo, for example when visitors changed it or the exam date (`--exam-in-days` from the run) has come close.

## Making a gold course

1. Write the Materials (lecture notes, a problem sheet with solutions, an old exam) as PDFs.
2. Run the app with a real model, sign in, create the Course, upload the Materials, fill in the Brief and wait for the map and Topics.
3. Fix what the pipeline got wrong in the app, so the snapshot is the map you want the tutor to start from.
4. `pnpm gold export <course-id> <slug>`, then commit the folder.

## What a snapshot holds

Everything the pipeline stores for a Course: Materials and their pages, chunks with embeddings, the Knowledge map, Exercises, Topics and the Brief with its exam scopes. It holds nothing a Student did (Chats, attempts, Memory, generated Problems, mock exams). A seed gives every row a new id, so it can be run again and in parallel Students. A new table with Course content must be added to `SNAPSHOT_TABLES`.

## linear-algebra-I

The gold course of the Knowledge map pipeline v2 (#222). `pages.json` holds the recorded page results and structure call's Outline of `lecture-notes.pdf` pp. 17–24 (the end of Chapter 3 and Chapter 4, Vector Spaces) and `exercises.pdf` pp. 3 and 5 (Exercises 7–16 and solutions), which `pnpm smoke pair` and `pnpm smoke map` parse without page calls (`evals/smoke/recorded-pages.ts`); a change to the page schema records them again. The smoke checks that need a built map (`tutor`, `generate`, `mock`, `grade-mock`, `close`) seed its snapshot for their Student (`evals/smoke/gold-course.ts`) and stop with "Run the gold run first (#222)" until the snapshot exists. Its Materials are one AI-written 55-page script, split into three PDFs so that its old exams are a Material of their own. Each file keeps its part of the outline.

| File                | Pages of the script | What it holds                                                                                |
| ------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `lecture-notes.pdf` | 1–38                | Course information (admission, exam format and dates) and Chapters 1–7                       |
| `exercises.pdf`     | 39–44               | Exercises 1–25; solutions to the 11 marked (S); printed results for Exercises 7 and 17       |
| `past-exams.pdf`    | 45–55               | Final and Resit exam of winter term 2025/26, 6 problems each, each followed by its solutions |

**Judging a run.** `reference-map.json` is the Knowledge map Claude Opus 5.5 extracted from the unsplit 55-page script in one pass, with the extraction prompt's KC rule: 113 KCs (107 taught by the lecture notes, 6 only by Exercises and old exams), 204 Prerequisites, 16 Topics, the pages that teach nothing, what the script assumes from outside, and each Exercise and exam problem with the KCs it tests and its unique printed results as answer keys. Page numbers are those of the unsplit script. A run is judged against it on coverage (reference KCs matched, same or one step finer or coarser), non-KCs and duplicates, Prerequisite precision and recall, the Topic tree, Exercise tagging and answer keys. Each judged run is kept in `runs/` with its alignment (`referenceToRun` maps reference KC ids to the run's KC positions), so the next run can be compared without staging access.
