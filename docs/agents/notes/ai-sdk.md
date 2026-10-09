# AI SDK 7

The installed `ai` package is version 7; most training data is version 5 or 6. Read `node_modules/ai/docs/08-migration-guides/23-migration-guide-7-0.mdx` before writing AI SDK code from memory.

- **Renames**: `system` is `instructions`, `onFinish` is `onEnd`, `experimental_onToolCallFinish` is `onToolExecutionEnd`.
- **Stopping a stream**: pass `abortSignal: request.signal` to `streamText`, and `consumeSseStream: consumeStream` to `createUIMessageStreamResponse`, so `onEnd` still runs when the client disconnects; `onEnd` then reports `isAborted`. A stopped or failed call reports no usage. `src/features/chat/server/handler.ts` is the worked example, including estimating the cost of a stopped reply. Guide: `node_modules/ai/docs/06-advanced/02-stopping-streams.mdx`.
- **Route handlers** answer `401` for a signed-out user; `requireUser` redirects, which suits pages only.
- **Errors**: a call that exhausted its retries throws `RetryError` with the provider's `APICallError` as `lastError`; `statusCode` is on the `APICallError`.
- **Custom data parts and file parts** (`convertDataPart`, bytes in file parts, what the mock sees): `ai-sdk-file-parts.md`.
