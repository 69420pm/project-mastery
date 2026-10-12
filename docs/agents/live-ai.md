# Live AI calls

Live model calls spend the user's Gemini free-tier quota: per model and per day, shared by every checkout. Quotas, error shapes and how to tell them apart are in [the free-tier note](notes/gemini-free-tier.md).

- **Default:** tests, runtime checks and `run-app` use `AI_PROVIDER=mock`.
- **Allowed without asking, on `gemini-3.5-flash-lite` only:** a spec's smoke check, once per build; a single call to see how a provider responds; and, while writing a spec, a few calls to verify a provider fact. That adds up to about 20 calls per spec.
- **Ask the user first:** flash and Pro models (20 requests a day) and evals (`pnpm evals`).
- **Embeddings** have their own small quota, and every chunk counts as one request, so a smoke check embeds a few chunks.
- **The guard:** the Bash guard refuses evals, smoke checks and direct model calls unless the command starts with `ALLOW_LIVE_AI=1`.
- **Smoke checks** (`pnpm smoke <name>`) are defined under [Project structure](../ARCHITECTURE.md#project-structure), with their call cap.
- **Quota exhausted:** a 429 with a per-day quota id means the day's quota is gone. Stop making live calls and say what stayed unverified.

When a live call shows a provider behaviour the mock lacks (no usage reported, an error shape, an empty result), add it to the mock and a line to `docs/agents/notes/`.
