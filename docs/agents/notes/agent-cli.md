# Agent CLI (`pnpm -s agent`)

- `agent up` starts `next dev` with the checkout's `.env.local`, which may set `AI_PROVIDER=gateway`: the app then makes live model calls. Start it as `AI_PROVIDER=mock pnpm -s agent up` for a runtime check; neither tsx's `--env-file` nor Next.js overrides a variable already set (verified 2026-10-26 in `/proc/<pid>/environ`).
- `psql` is not installed on the host. For a multi-statement seed, pipe the file into the database container: `docker exec -i supabase_db_project-mastery psql -U postgres -v ON_ERROR_STOP=1 -q < seed.sql`.
