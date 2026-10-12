# PDF page rendering and the parse workflow

Installed: unpdf 1.8.1, @napi-rs/canvas 1.0.11, workflow 5.0.1. Code: `src/features/ingestion/workflows/page-images.ts`, `parse-steps.ts`; the browser side: `src/components/page-crop.tsx`.

- **Native binding must stay external.** Bundled by Next.js (Turbopack), `@napi-rs/canvas` fails in a step with "Cannot find native binding". `next.config.ts` lists it in `serverExternalPackages`; Next's built-in list has `canvas` but not `@napi-rs/canvas`.
- **Rendering.** `renderPageAsImage(pdf, n, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 })` returns PNG bytes; `getDocumentProxy` takes ownership of its buffer, so pass a copy. Hand-written fixture PDFs with inexact xref offsets still open.
- **Nothing is stored per page.** `readPage` opens the Material's PDF and renders its page for the call, then drops it, so a page step downloads and opens the whole PDF once per page (the cost of not keeping page images). `preparePages` opens it once for the page count.
- **Workflows locally.** Runs started from a Server Action execute in the dev server and in `next start`, with the local world. The proxy matcher must skip `/.well-known/workflow/`.
- **Vercel: unverified.** Whether `@napi-rs/canvas` loads in a deployed `fra1` function (linux-x64-gnu binding) has not been checked with a preview deployment yet.
- **Figures (browser).** A chunk's figure is `{ description, page, box }`; the box is normalized, padded and at least 25% of the page wide (`domain/figure-box.ts`), `null` for the whole page. `PageCrop` renders that page with react-pdf at `frame width / box width` and clips it with CSS, or crops an image Material's file the same way. All crops of a file share one pdf.js document (`pdf-page-crop-core.tsx`). `sharp` is used by tests only.
