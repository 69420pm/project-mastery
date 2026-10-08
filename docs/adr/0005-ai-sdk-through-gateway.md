# Vercel AI SDK through Vercel AI Gateway

**Context.** The app uses several models for different tasks, and the right model per task will change as models improve. Switching providers should be a configuration change.

**Decision.** Call models through the Vercel AI SDK and route requests through Vercel AI Gateway. Model choice lives in one per-task configuration (for example `chat`, `ingest`, `embed`), not in feature code. A task's configuration may also define the models a Student can choose from for that task, each with a label and a model id. Feature code and the browser address a choice by its key (for example `balanced`), never by a model id, and the server validates the key. No additional agent framework.

**Consequences.** One API key and one bill for every provider, no token markup, fallbacks and spend tracking in one place. The AI SDK covers streaming chat UIs, structured output with Zod, tool calling and mock models for tests. Each task uses the smallest model that does it well, as [VISION.md](../../VISION.md) requires. Changing the models behind a choice stays a configuration change, plus a price (ADR 0006).
