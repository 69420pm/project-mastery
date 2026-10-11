# AI SDK 7

The installed `ai` package is version 7; most training data is version 5 or 6. Read `node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx` before writing AI SDK code from memory.

- **Renames**: `system` is `instructions`, `onFinish` is `onEnd`, `experimental_onToolCallFinish` is `onToolExecutionEnd`.
- **Stopping a stream**: pass `abortSignal: request.signal` to `streamText`, and `consumeSseStream: consumeStream` to `createUIMessageStreamResponse`, so `onEnd` still runs when the client disconnects; `onEnd` then reports `isAborted`. A stopped or failed call reports no usage. `src/features/chat/server/handler.ts` is the worked example, including estimating the cost of a stopped reply. Guide: `node_modules/ai/docs/06-advanced/02-stopping-streams.mdx`.
- **Route handlers** answer `401` for a signed-out user; `requireUser` redirects, which suits pages only.
- **Errors**: a call that exhausted its retries throws `RetryError` with the provider's `APICallError` as `lastError`; `statusCode` is on the `APICallError`.
- **Embedding usage**: the Gemini provider's `doEmbed` returns `usage: undefined`, and `embedMany` then reports `usage.tokens` as `NaN`. Check `Number.isFinite` and estimate (`estimatedUsage`); the mocks return `undefined` too. `MockEmbeddingModelV4` defaults to one value per call unless given `maxEmbeddingsPerCall`.
- **Retries inside a Workflow step**: pass `maxRetries: 0` and turn the `APICallError` into `RetryableError` (with the provider's delay) or `FatalError`, as `embed-chunks.ts` does; otherwise the AI SDK's retries multiply with the step's (default 3 retries, so 4 attempts).
- **Langfuse input of embeddings**: `@ai-sdk/otel` writes `ai.values` only with its `embedding` option, which `LangfuseVercelAiSdkIntegration` does not expose, and Langfuse maps `ai.values` to metadata, not input. `src/lib/tracing/ai-sdk-telemetry.ts` sets `langfuse.observation.input` instead.
- **Custom data parts and file parts** (`convertDataPart`, bytes in file parts, what the mock sees): `ai-sdk-file-parts.md`.
