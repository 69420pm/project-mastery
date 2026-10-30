# Gold courses

A gold course is a Course whose Materials are AI-written, so they are safe to publish, and whose pipeline output is kept in the repo as a **snapshot**. Manual testing and smoke checks can load the snapshot instead of running the expensive pipeline (parse and Update map) again.

```
evals/gold/<slug>/
  snapshot.json.gz     the Course's built content (tables in evals/gold-snapshot.ts)
  materials/<id>.pdf   the uploaded files the snapshot's Materials point at
  pages.json           recorded page results of some pages, by file (linear-algebra-I)
```

## Commands

Local database only, no model calls (`evals/smoke/gold-cli.ts`, which may use the service role).

| Command                                            | What it does                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm gold export <course-id> <slug> [--name "…"]` | Writes a Course from the local database into `evals/gold/<slug>/`.                                                                                                                                                   |
| `pnpm gold seed <slug> [--exam-in-days 42]`        | Creates or reuses the gold Student (`gold@example.com`, password `gold-password`; `GOLD_EMAIL` and `GOLD_PASSWORD` override), replaces its Course of the same name and sets the Brief's exam date relative to today. |
| `pnpm gold list`                                   | Lists the snapshots.                                                                                                                                                                                                 |

## Making a gold course

1. Write the Materials (lecture notes, a problem sheet with solutions, an old exam) as PDFs.
2. Run the app with a real model, sign in, create the Course, upload the Materials, fill in the Brief and wait for the map and Topics.
3. Fix what the pipeline got wrong in the app, so the snapshot is the map you want the tutor to start from.
4. `pnpm gold export <course-id> <slug>`, then commit the folder.

## What a snapshot holds

Everything the pipeline stores for a Course: Materials and their pages, chunks with embeddings, the Knowledge map, Exercises, Topics and the Brief with its exam scopes. It holds nothing a Student did (Chats, attempts, Memory, generated Problems, mock exams). A seed gives every row a new id, so it can be run again and in parallel Students. A new table with Course content must be added to `SNAPSHOT_TABLES`.

## linear-algebra-I

The gold course of the Knowledge map pipeline v2 (#222). `pages.json` holds the recorded page results of `lecture-notes.pdf` pp. 19–22 (Vector Spaces) and `exercises.pdf` pp. 3 and 5 (Exercises 7–16 and solutions), which `pnpm smoke pair` and `pnpm smoke map` parse without page calls (`evals/smoke/recorded-pages.ts`); a change to the page schema records them again. The smoke checks that need a built map (`tutor`, `generate`, `review`, `mock`, `grade-mock`, `close`, `map-findings`) seed its snapshot for their Student (`evals/smoke/gold-course.ts`) and stop with "Run the gold run first (#222)" until the snapshot exists. Its Materials are one AI-written 55-page script, split into three PDFs so that its old exams are a Material of their own. Each file keeps its part of the outline.

| File                | Pages of the script | What it holds                                                                                |
| ------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `lecture-notes.pdf` | 1–38                | Course information (admission, exam format and dates) and Chapters 1–7                       |
| `exercises.pdf`     | 39–44               | Exercises 1–25; solutions to the 11 marked (S); printed results for Exercises 7 and 17       |
| `past-exams.pdf`    | 45–55               | Final and Resit exam of winter term 2025/26, 6 problems each, each followed by its solutions |
