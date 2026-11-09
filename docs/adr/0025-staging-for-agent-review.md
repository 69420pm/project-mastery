# Staging for agent review

**Context.** [ADR 0015](0015-agent-cli-for-running-app.md) kept staging and production out of agents' reach, so every check ran on the local stack, with seeded test users and no real rows. The maintainer now wants agents to review real rows in the staging project. Staging holds no production data. Production stays out of reach.

**Decision.** The local stack stays the default for every command, tests and the run-app flow. Agents reach the staging project only to read, through two commands:

- **REST reads.** `pnpm -s agent staging "<table>?<params>"` sends GET requests to the staging REST API with `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SECRET_KEY` from `.env.local`. It takes a table name and PostgREST parameters only, so `rpc/` functions and single-row paths are refused. A query returns 20 rows unless it sets `limit`, at most 200.
- **SQL reads.** `pnpm -s agent staging-sql "<query>"` runs one read-only statement as a Postgres role that can only read, with `STAGING_DATABASE_URL` from `.env.local`. The statement runs in a read-only transaction, and output is capped at 200 rows.

Agents never write to staging (superseded by [ADR 0029](0029-agent-writes-to-staging.md): row writes through `staging-write`). Migrations reach staging the same way they always have: applied by hand.

**Consequences.** Agents can check behaviour against real rows, which the seeded local data cannot show. The secret key bypasses Row Level Security, so the REST reads rely on the CLI's GET-only rule. SQL is guarded by the database itself: the role has `select` grants only, and the read-only transaction and single-statement check are second layers. The role should also be able to see every row (it needs `bypassrls`, or policies that allow it), or reviews will show less than the database holds. Rows an agent reads enter the model context and the transcript, so the staging project should hold only data the maintainer accepts there. This supersedes the staging clause of ADR 0015; its rule for production stands.
