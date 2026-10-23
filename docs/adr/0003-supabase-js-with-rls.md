# supabase-js with Row Level Security instead of an ORM

**Context.** An ORM such as Drizzle connects with a database role that bypasses Row Level Security, so access control would live in application code. supabase-js calls run as the signed-in user, so Postgres enforces it.

**Decision.** Access data through supabase-js with types generated from the schema. Write schema changes as SQL migrations with the Supabase CLI. Row Level Security policies are the security boundary for both tables and stored files.

**Consequences.** Every table needs policies, and tests cover them. Server-only code that must bypass policies (for example background jobs) uses the service role deliberately and in few places: background workflows, the smoke checks in `evals/smoke/`, and `evals/metrics-cli.ts` (`pnpm -s metrics`), a local operator script that must read every Student's Chats, which no Student client can. The lint rule names each of them, and a new use needs a line here.
