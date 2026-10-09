# AI SDK 7: custom data parts and file parts

Installed `ai` 7.0.127. Verified in `node_modules/ai/dist/index.js` and `node_modules/ai/docs/07-reference/02-ai-sdk-ui/31-convert-to-model-messages.mdx` (lines 129-290).

- **Async.** `convertToModelMessages` returns a Promise. `src/features/chat/server/handler.ts:200` awaits it.
- **Data parts are dropped by default.** On user messages, `data-*` parts reach `convertDataPart` (index.js:~10612). Return a text or file part to keep one, or `undefined` to skip it.
- **Typing.** `convertToModelMessages<M>` types `part.data` from `M`'s data map (index.d.ts:5719). Define `UIMessage<Metadata, { 'my-part': {...} }>`. The repo's `ChatUIMessage` (`src/features/chat/types.ts`) has no data parts yet.
- **Validation.** `validateUIMessages` checks data parts only when `dataSchemas` is passed. Then every `data-*` part needs a schema, or it fails with "No data schema found for data part X" (index.js:~11116). `handler.ts:184` passes no `dataSchemas`.
- **File parts in UI messages are URL-only.** `FileUIPart` is `{ type: 'file', mediaType, filename?, url }`, and `url` is a hosted URL or a `data:` URL. Inline bytes must be base64 in a data URL. Conversion calls `new URL(part.url)`, and data URLs decode without a download (index.js:~1218, ~10606).
- **Bytes in convertDataPart.** Return a `FilePart` with `data: Uint8Array` (or base64 string) and `filename`. Type: `DataContent = string | Uint8Array | ArrayBuffer | Buffer`, in `@ai-sdk/provider-utils`.
- **Hosted URLs get fetched.** For a file part with an http(s) URL, the SDK downloads it before the call when the model does not support that URL (index.js:~1560-1585). A signed Storage URL is downloaded that way, so prefer bytes already in hand.
- **What the model sees.** The prompt gets `{ type: 'file', mediaType, filename, data: { type: 'data', data } }`, where `data` is a `Uint8Array` or base64 string (index.js:~1589-1625). The repo's mock (`src/lib/ai/mock-provider.ts`, `lastUserText`) reads text parts only, so PDFs never affect mock replies. To test that a file reached the model, assert on the `prompt` passed to `doGenerate` or `doStream`.
