# Live AI calls

Locally, `AI_PROVIDER=google` calls the Gemini API free tier with the user's key; staging and production go through AI Gateway (ADR 0006). Live calls spend the free-tier quota, per model and per day, shared by every checkout.

- **Default:** tests, runtime checks and `run-app` use `AI_PROVIDER=mock`.
- **The one model agents call:** `gemini-3.5-flash-lite`, sparingly, while implementing and reviewing: a spec's smoke check once per build, a single call to see how a provider responds, a few calls to verify a provider fact. Embeddings (`gemini-embedding-2`) are the exception the smoke checks need.
- **Every other model, and evals (`pnpm evals`),** run only when the user asks for it in the session. The flash models allow 20 requests a day.
- **The guard:** the Bash guard refuses evals, smoke checks and direct model calls unless the command starts with `ALLOW_LIVE_AI=1`.
- **Smoke checks:** `pnpm smoke <name>` runs `evals/smoke/<name>.ts`: one real feature path once, on a small input, with every generating task on `gemini-3.5-flash-lite` and at most 10 model calls, checking the feature's invariants. A spec names its smoke check, and `/build` runs it before the PR. They never run in `pnpm check` or CI.
- **Quota exhausted:** a 429 with a per-day quota id means the day's quota is gone. Stop making live calls and say what stayed unverified.

When a live call shows a provider behaviour the mock lacks (no usage reported, an error shape, an empty result), add it to the mock and a line to `docs/agents/notes/`.

## Free-tier quotas

| Model                                                     | RPM | TPM  | RPD |
| --------------------------------------------------------- | --- | ---- | --- |
| `gemini-3.8-flash`, `3.7-flash`, `3.6-flash`, `3.5-flash` | 5   | 250k | 20  |
| `gemini-3.5-flash-lite`                                   | 15  | 250k | 900 |

Requests per day are the bottleneck, and retries count as requests. `gemini-embedding-2` has its own quota (`embed_content_free_tier_requests`, a limit of 100, probably per minute), and each value in a `batchEmbedContents` call counts as one request, so a smoke check embeds a few chunks. Thinking tokens count towards TPM and cost: a flash call for "hi" used over 100. An older id can answer as a newer model (`gemini-3.7-flash` returned `modelVersion: gemini-3.8-flash`), so the two may share a quota.

The key cannot report its remaining quota: responses carry no rate-limit headers, and the usage APIs need OAuth. The user sees it at https://ai.dev/rate-limit. `countTokens` spends no generation quota and sizes a prompt against TPM.

## Telling errors apart

Read the body before deciding. In the AI SDK the status is `statusCode` on the `APICallError` inside the `RetryError` (see `notes/ai-sdk.md`), and the raw body is `responseBody`.

| Status | `error.status`       | Meaning                                                                                                     |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| 429    | `RESOURCE_EXHAUSTED` | Quota used up. `details` has a `QuotaFailure` with a `quotaId` and a `RetryInfo` with a `retryDelay`.       |
| 400    | `INVALID_ARGUMENT`   | Malformed request: `details` lists `fieldViolations`.                                                       |
| 404    | `NOT_FOUND`          | Unknown model id.                                                                                           |
| 503    | `UNAVAILABLE`        | Google-side demand spike, not quota. It clears by itself, and a "rate limited" flash model may just be 503. |

The `quotaId` names the limit hit:

- `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`: RPM. `retryDelay` is seconds, so waiting works.
- `...PerDay...`: RPD. Nothing helps until the daily reset.
- A `...Token...` id: TPM. Send smaller prompts or wait a minute.
