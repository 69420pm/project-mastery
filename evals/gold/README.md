# Gold courses

A gold course is a Course whose Materials are AI-written, so they are safe to publish, and whose pipeline output is kept in the repo as a **snapshot**. Evals and manual testing load the snapshot instead of running the expensive pipeline (parse, map, topics, priorities, reading sections) again.

```
evals/gold/<slug>/
  snapshot.json.gz     the Course's built content (tables in evals/gold-snapshot.ts)
  materials/<id>.pdf   the uploaded files the snapshot's Materials point at
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
2. Run the app with a real model, sign in, create the Course, upload the Materials, fill in the Brief and wait for the map, Topics and Reading sections.
3. Fix what the pipeline got wrong in the app (answer the Findings), so the snapshot is the map you want the tutor to start from.
4. `pnpm gold export <course-id> <slug>`, then commit the folder.

## What a snapshot holds

Everything the pipeline stores for a Course: Materials and their pages, chunks with embeddings, the Knowledge map, Exercises, Findings, Topics, Reading sections, priorities and the Brief. It holds nothing a Student did (Chats, attempts, Memory, generated Problems, mock exams). A seed gives every row a new id, so it can be run again and in parallel Students. A new table with Course content must be added to `SNAPSHOT_TABLES`.

## jet-engines

The first gold course (`jet-engines/`) is a hand-checked fixture for the map eval and the scripted tutoring evals, without a snapshot.
