# AI SDK 7

The installed `ai` package is version 7; most training data is version 5 or 6. Read `node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx` before writing AI SDK code from memory.

- **Renames**: `system` is `instructions`, `onFinish` is `onEnd`, `experimental_onToolCallFinish` is `onToolExecutionEnd`.
- **Stopping a stream**: pass `abortSignal: request.signal` to `streamText`, and `consumeSseStream: consumeStream` to `createUIMessageStreamResponse`, so `onEnd` still runs when the client disconnects; `onEnd` then reports `isAborted`. A stopped or failed call reports no usage. `src/features/chat/server/handler.ts` is the worked example, including estimating the cost of a stopped reply. Guide: `node_modules/ai/docs/06-advanced/02-stopping-streams.mdx`.
- **Route handlers** answer `401` for a signed-out user; `requireUser` redirects, which suits pages only.
- **Errors**: a call that exhausted its retries throws `RetryError` with the provider's `APICallError` as `lastError`; `statusCode` is on the `APICallError`.
- **Embedding usage**: the Gemini provider's `doEmbed` returned `usage: undefined` (verified when development used it); `cohere/embed-v5.0-fast` through the gateway reports `usage.tokens` (verified 2026-10-14), and `embedMany` then reports `usage.tokens` as `NaN`. Check `Number.isFinite` and estimate (`estimatedUsage`); the mocks return `undefined` too. `MockEmbeddingModelV4` defaults to one value per call unless given `maxEmbeddingsPerCall`.
- **Retries inside a Workflow step**: pass `maxRetries: 0` and turn the `APICallError` into `RetryableError` (with the provider's delay) or `FatalError`, as `embed-chunks.ts` does; otherwise the AI SDK's retries multiply with the step's (default 3 retries, so 4 attempts).
- **Langfuse input of embeddings**: `@ai-sdk/otel` writes `ai.values` only with its `embedding` option, which `LangfuseVercelAiSdkIntegration` does not expose, and Langfuse maps `ai.values` to metadata, not input. `src/lib/tracing/ai-sdk-telemetry.ts` sets `langfuse.observation.input` instead.

## Exercise checking on flash-lite

Verified 2026-10-13 on the Gemini API; on 2026-10-14 `xiaomi/mimo-v2.6-flash` with `reasoning: "medium"` through the gateway did catch the printed error (`pnpm smoke map` finding for Ex. 7.1: given 0.465, calculated 0.508) with live `exercise` calls on the jet-engines Ex 7.1 (ideal Brayton, r_p = 12, true efficiency 50.8%, printed 46.5%).

- **`gemini-3.5-flash-lite` with `thinkingLevel: 'medium'` does not catch the printed error.** Given the solution, it copies the printed intermediate `(1/12)^0.2857 ≈ 0.535` and answers `matchesGiven: true`, even when told never to copy given values. Without the solution it computes `12^0.2857 ≈ 2.148` (true 2.034) and answers 53.5%. Its arithmetic with fractional powers is unreliable, so `pnpm smoke map` reports Ex 7.1 `verified` on flash-lite. Catching it needs a stronger model or a calculator tool.

## Data parts and file parts

Verified in `node_modules/ai/dist/index.js` and `node_modules/ai/docs/07-reference/02-ai-sdk-ui/31-convert-to-model-messages.mdx`.

- **`convertToModelMessages` is async**, and it drops `data-*` parts on user messages unless `convertDataPart` returns a text or file part for one. `src/features/chat/server/attached-materials.ts` is the worked example: it turns a `data-material` part into the Material's file.
- **Typing**: `UIMessage<Metadata, DataParts>` types `part.data`, as `ChatUIMessage` in `src/features/chat/types.ts` does.
- **Validation**: once `validateUIMessages` gets `dataSchemas`, as the Chat handler passes, every `data-*` part needs a schema or fails with "No data schema found for data part X".
- **File parts in UI messages are URL-only** (`{ type: 'file', mediaType, filename?, url }`), with inline bytes as a base64 `data:` URL. A file part returned from `convertDataPart` takes `data: Uint8Array` or base64 instead.
- **Hosted URLs get downloaded** before the call when the model does not support that URL, a signed Storage URL included, so prefer bytes already in hand.
- **The mock** (`src/lib/ai/mock-provider.ts`) names the attached files in its reply, so a test sees what reached the AI. To check the bytes, assert on the `prompt` passed to `doGenerate` or `doStream`.

## MiMo through AI Gateway

Verified live on 2026-10-14.

- **Structured output needs DeepInfra.** Of MiMo V2.6 Flash's six gateway providers only `deepinfra` sends the JSON schema; the others get `json_object` mode, answer in their own shape and `Output.object` throws `NoObjectGeneratedError` (the AI SDK warns "responseFormat … only supported with structuredOutputs"). `providerOptions.gateway.order` was ignored for requests with an image; `only` works but removes `models` fallbacks (`ONLY_PROVIDERS` in `src/lib/ai/models.ts`).
- **Tags** in `providerOptions.gateway.tags` (`task:<name>`) work for language and embedding calls; `useMockModels` reads them to give tasks that share a model id their own mock.
- **Reasoning** is on by default; the top-level `reasoning` setting works (`"none"` gives 0 reasoning tokens).
