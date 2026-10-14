# Live AI calls

Every environment calls models through AI Gateway (ADR 0006); locally it takes `AI_GATEWAY_API_KEY` from `.env.local`. Live calls spend the Gateway's monthly free credit of $5, shared by every checkout and by the preview deployments. Cheap calls make that plenty: `xiaomi/mimo-v2.6-flash` costs $0.14 per million input and $0.28 per million output tokens, `cohere/embed-v5.0-fast` $0.08 per million.

- **Default:** tests, runtime checks and `run-app` use `AI_PROVIDER=mock`.
- **Live calls are welcome** while implementing and reviewing, on `xiaomi/mimo-v2.6-flash` and `cohere/embed-v5.0-fast`: a spec's smoke check, a call to see how a provider responds, calls to verify a provider fact, an eval after changing a prompt. Keep them purposeful, not a loop: a smoke check costs cents.
- **Every other model** (Google models, Pro models, `AI_MODEL_*` overrides) only when the user asks for it in the session or a spec requires it.
- **The guard:** the Bash guard refuses evals, smoke checks and direct model calls unless the command starts with `ALLOW_LIVE_AI=1`.
- **Smoke checks:** `pnpm smoke <name>` runs `evals/smoke/<name>.ts`: one real feature path once, on a small input, with every generating task on `xiaomi/mimo-v2.6-flash` and at most 30 model calls (a check may set its own cap), checking the feature's invariants. A spec names its smoke check, and `/build` runs it before the PR. They never run in `pnpm check` or CI.
- **Credit exhausted or rate limited:** a 429 or 402 that retrying does not clear means the free credit is gone or the key is limited (not yet seen live: read the body). Stop making live calls and say what stayed unverified. The user sees the balance in the Vercel dashboard under AI Gateway.

When a live call shows a provider behaviour the mock lacks (no usage reported, an error shape, an empty result), add it to the mock and a line to `docs/agents/notes/`.

## What a call costs

Every call is priced from `src/lib/ai/prices.ts` and recorded in `ai_usage`, so `select task, model_id, cost_usd from ai_usage` shows what a run spent. Reasoning tokens count as output, so a call with `reasoning` set can spend several times its visible output. Embeddings of different models are not comparable and `chunks.embedding` has one size (2048 dimensions, the default of `cohere/embed-v5.0-fast`), so a changed `embed` model needs a migration and a re-parse.

## Telling errors apart

Read the body before deciding. In the AI SDK the status is `statusCode` on the `APICallError` inside the `RetryError` (see `notes/ai-sdk.md`), and the raw body is `responseBody`.

| Status | Meaning                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| 401    | The key is missing, wrong or expired (an OIDC token from `vercel env pull` lasts 12 hours).                    |
| 402    | Probably the credit is used up (not yet seen live).                                                            |
| 429    | Rate limited. `retry-after` headers say how long; waiting works.                                               |
| 400    | Malformed request, or input the model does not take (a PDF sent to a model without file input): read the body. |
| 404    | Unknown model id.                                                                                              |
| 5xx    | Provider-side trouble that clears by itself; the gateway tries the task's fallback models first.               |

A fallback that answered is recorded as the call's model, not the primary.
