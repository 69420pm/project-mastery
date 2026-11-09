# Agent writes to staging

**Context.** [ADR 0025](0025-staging-for-agent-review.md) let agents read the staging project and never write to it. The maintainer now needs agents to change staging rows to test against real data. Production stays out of reach.

**Decision.** `pnpm -s agent staging-write "<POST|PATCH|DELETE> <table>?<params>" '<json body>'` writes to the staging REST API with `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SECRET_KEY` from `.env.local`. It takes a table name only, so `rpc/` functions and single-row paths are refused. `PATCH` and `DELETE` must carry a filter, so one call cannot rewrite or empty a whole table. `POST` with `on_conflict=<column>` upserts. The affected rows are printed. Reads stay as in ADR 0025: `staging` sends GET requests only, and `staging-sql` runs as the read-only role in a read-only transaction.

Still not allowed: SQL writes and schema changes (DDL), and anything against production. Migrations reach staging as before, applied by hand.

**Consequences.** Agents can set up and change rows on staging. The secret key bypasses Row Level Security, so the table and filter rules in the CLI are the only guard; a mistake changes real staging rows and there is no undo. Agents write only what the task needs and name what they changed. This supersedes the "agents never write to staging" sentence of ADR 0025.
