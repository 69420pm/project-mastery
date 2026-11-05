# Staging for agent review and migrations

**Context.** [ADR 0015](0015-agent-cli-for-running-app.md) kept staging and production out of agents' reach, so every check ran on the local stack, with seeded test users and no real rows. The maintainer now wants agents to review real rows in the staging project, and wants migrations to reach staging on every merge without a manual step. Staging holds no production data. Production stays out of reach.

**Decision.** The local stack stays the default for every command, tests and the run-app flow. The staging project is reached in two ways only:

- **Reading.** `pnpm -s agent staging "<table>?<params>"` sends GET requests to the staging REST API with `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SECRET_KEY` from `.env.local`. It takes a table name and PostgREST parameters only, so `rpc/` functions and single-row paths are refused. A query returns 20 rows unless it sets `limit`, at most 200.
- **Migrating.** The `migrate-staging` workflow runs `supabase db push` against the staging project after each push to `main` that changes `supabase/migrations/`. It runs one at a time. Production migrations stay manual.

Agents never write to staging and never migrate it by hand.

**Consequences.** Agents can check behaviour against real rows, which the seeded local data cannot show. The secret key bypasses Row Level Security, so the GET-only rule in the CLI is the only guard against writes. A read-only database role would enforce that in the database, and is the next step if agents need more than review. Rows an agent reads enter the model context and the transcript, so the staging project should hold only data the maintainer accepts there. A failed migration fails the workflow run, and the next merge to `main` retries it. This supersedes the staging clause of ADR 0015; its rule for production stands.
