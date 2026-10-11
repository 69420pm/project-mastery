# Durable background jobs

**Context.** Ingestion and planning take minutes and must survive timeouts and failed model calls. A single serverless request is not enough.

**Decision.** Run long tasks as durable workflows on Vercel Workflow, with retries per step. Inngest was the alternative. The planned comparison was skipped: Vercel Workflow was already set up, runs on the existing platform without another service, and the Material parse fits its step model (prepare, one step per page, write the chunks).

**Consequences.** Jobs report progress through the database, so the UI can show it. Steps run on the admin client and scope every query to the Student themselves. Workflow and step functions are plain functions without the compiler, so tests run a whole workflow in-process against `fakeSupabase` and mock models. The proxy leaves Vercel Workflow's internal routes (`/.well-known/workflow/`) alone.
