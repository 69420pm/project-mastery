# Live AI calls

Deployments call models through AI Gateway (ADR 0006). Locally, the text tasks call the Gemini API directly with `GOOGLE_GENERATIVE_AI_API_KEY`, and the `AI_MODEL_*` overrides in the developer's `.env.local` point them at `google/gemini-3.5-flash-lite` (ADR 0016). Embeddings and the smoke checks use AI Gateway with `AI_GATEWAY_API_KEY`. Gateway live calls spend its monthly free credit of $5, shared by every checkout and by the preview deployments. Cheap calls make that plenty: `xiaomi/mimo-v2.6-flash` costs $0.14 per million input and $0.28 per million output tokens, `cohere/embed-v5.0-fast` $0.08 per million. Gemini calls spend the Gemini API's daily free quota instead.

- **Default:** tests, runtime checks and `run-app` use `AI_PROVIDER=mock`.
- **Live calls are welcome** while implementing and reviewing, on `xiaomi/mimo-v2.6-flash` and `cohere/embed-v5.0-fast`, and on `google/gemini-3.5-flash-lite` for local text calls: a spec's smoke check, a call to see how a provider responds, calls to verify a provider fact, an eval after changing a prompt. `alibaba/qwen3.7-flash` is welcome as the second judge candidate of `pnpm evals calibrate`. Keep them purposeful, not a loop: a smoke check costs cents.
- **Every other model** (other `AI_MODEL_*` overrides, Pro models) only when the user asks for it in the session or a spec requires it. The free credit serves only a subset of the Gateway's models: `xiaomi/mimo-v2.6-flash`, `xiaomi/mimo-v2.5`, `openai/gpt-4.1-nano`, `openai/gpt-5-nano`, `alibaba/qwen3.7-flash`, `amazon/nova-lite` and `spacexai/grok-4.1-fast-reasoning` answered on 2026-10-14; every Google model, `openai/gpt-6-luna`, `anthropic/claude-haiku-5.5`, `xiaomi/mimo-v2.6-pro`, `alibaba/qwen3.8-flash`, `minimax/minimax-m3` and `google/gemma-4-31b-it` got a 403.
- **Verified on 2026-10-23:** `deepseek/deepseek-v3.1` still answered on the free credit, but DeepSeek V4 and V4.1 Flash got a 403. `alibaba/qwen3.7-flash` answered with structured output at $0.03 per million input and $0.13 per million output tokens under 32k input tokens (higher tiers above), and it reasons by default: 544 reasoning tokens on a one-line verdict.
- **The guard:** the Bash guard refuses evals (`pnpm evals draft` and `pnpm evals calibrate` included; `pnpm evals:report` only reads Langfuse and is allowed), smoke checks and direct model calls unless the command starts with `ALLOW_LIVE_AI=1`.
- **Smoke checks:** `pnpm smoke <name>` runs `evals/smoke/<name>.ts`: one real feature path once, on a small input, with every generating task on `google/gemini-3.5-flash-lite` when `GOOGLE_GENERATIVE_AI_API_KEY` is set (locally), otherwise on `xiaomi/mimo-v2.6-flash`; `AI_SMOKE_MODEL` pins another model, such as MiMo through the gateway (ADR 0016). At most 30 model calls (a check may set its own cap), checking the feature's invariants. A check stops after 4 minutes (`AI_SMOKE_MAX_MINUTES`): a subagent's prompt cache expires after 5 idle minutes, and the turn after a longer wait writes the whole context again, about $1 for an Opus builder at 190k tokens (#83 paid $8 that way). A spec names its smoke check, and `/build` runs it before the PR. They never run in `pnpm check` or CI.
- **Credit exhausted or rate limited:** a 429 or 402 that retrying does not clear means the free credit is gone or the key is limited (not yet seen live: read the body). Stop making live calls and say what stayed unverified. The user sees the balance in the Vercel dashboard under AI Gateway.

When a live call shows a provider behaviour the mock lacks (no usage reported, an error shape, an empty result), add it to the mock and a line to `docs/agents/notes/`.

## What a call costs

Every call is priced from `src/lib/ai/prices.ts` and recorded in `ai_usage`, so `select task, model_id, cost_usd from ai_usage` shows what a run spent. Reasoning tokens count as output: on MiMo a small calculation took 0 tokens with `reasoning: "none"`, about 8,000 with `"medium"` and 5,600 with `"high"` (about $0.002), and `"none"` answered it wrong. Embeddings of different models are not comparable and `chunks.embedding` has one size (2048 dimensions, what `cohere/embed-v5.0-fast` returns, verified), so a changed `embed` model needs a migration and a re-parse. Measured on 2026-10-14: a one-page parse smoke check cost $0.0004, a map smoke check (12 calls) $0.009.

## Telling errors apart

Read the body before deciding. In the AI SDK the status is `statusCode` on the `APICallError` inside the `RetryError` (see `notes/ai-sdk.md`), and the raw body is `responseBody`.

| Status | Meaning                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| 401    | The key is missing, wrong or expired (an OIDC token from `vercel env pull` lasts 12 hours).                    |
| 403    | "Free tier users do not have access to this model": the free credit does not serve it (verified).              |
| 402    | Probably the credit is used up (not yet seen live).                                                            |
| 429    | Rate limited. `retry-after` headers say how long; waiting works.                                               |
| 400    | Malformed request, or input the model does not take (a PDF sent to a model without file input): read the body. |
| 404    | Unknown model id.                                                                                              |
| 5xx    | Provider-side trouble that clears by itself. A task's fallback models would be tried first, but none is set.   |

Fallbacks are supported (`fallbacks` in `src/lib/ai/models.ts`), but no task sets one. A fallback that answered would be recorded as the call's model, not the primary.
