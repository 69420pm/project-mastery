# PDF page rendering and the parse workflow

Installed: unpdf 1.8.1, @napi-rs/canvas 1.0.11, workflow 5.0.1. Code: `src/features/ingestion/workflows/page-images.ts`, `parse-steps.ts`.

- **Native binding must stay external.** Bundled by Next.js (Turbopack), `@napi-rs/canvas` fails in a step with "Cannot find native binding". `next.config.ts` lists it in `serverExternalPackages`; Next's built-in list has `canvas` but not `@napi-rs/canvas`. Verified 2026-10-11 under `next dev` and `next build` + `next start`.
- **Rendering.** `renderPageAsImage(pdf, n, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 })` returns PNG bytes; `getDocumentProxy` takes ownership of its buffer, so pass a copy. Hand-written fixture PDFs with inexact xref offsets still open.
- **Storage paths.** An object `a/b/m` and objects under `a/b/m/pages/` coexist in Supabase Storage (verified on the local stack). A non-recursive `list(a/b)` then returns `m` twice: the file, and a folder entry with `id: null`.
- **Workflows locally.** Runs started from a Server Action execute in the dev server and in `next start`, with the local world. The proxy matcher must skip `/.well-known/workflow/`.
- **Vercel: unverified.** Whether `@napi-rs/canvas` loads in a deployed `fra1` function (linux-x64-gnu binding) has not been checked with a preview deployment yet.
- **Live model check: not run.** Whether `gemini-3.5-flash-lite` returns usable units and boxes for a page image waits for the user's allowance (`ALLOW_LIVE_AI`).
