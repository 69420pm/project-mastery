# Cohere embeddings through the Gateway

Installed: ai 7, @ai-sdk/gateway 4.0.120. Code: `EMBED_AS_DOCUMENTS` in `src/lib/ai/models.ts`, `meteredEmbed` in `src/features/usage/server/metered-call.ts`.

- **Document input type (2026-10-29, one live call).** `embedMany` on `cohere/embed-v5.0-fast` through the Gateway with `providerOptions: { cohere: { inputType: "search_document" } }` (next to the `gateway` options) answered 200: 2,048 dimensions, no warnings, usage reported (19 tokens), routed straight to `cohere` with system credentials. The gateway provider sends `providerOptions` in the request body as given (`gateway-embedding-model.ts`).
- **Unverified:** that the option changes the vector. Comparing it needs a second call on the same text without the option; no embedding from before was stored locally. Search queries are still embedded without an input type.
