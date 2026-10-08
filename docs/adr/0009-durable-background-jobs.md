# Durable background jobs

**Context.** Ingestion and planning take minutes and must survive timeouts and failed model calls. A single serverless request is not enough.

**Decision.** Run long tasks as durable workflows with retries per step. Vercel Workflow is the first candidate because it runs on the existing platform; Inngest is the alternative. A short spike on the first ingestion feature confirms the choice.

**Consequences.** Jobs report progress through the database, so the UI can show it. Vercel Workflow is set up; the comparison with Inngest still happens on the first ingestion feature.
