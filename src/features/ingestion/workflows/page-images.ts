import "server-only";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

/** Rendering scale: a US Letter page becomes 1224×1584 pixels. */
const RENDER_SCALE = 2;

/** An opened PDF, to count its pages and render them one by one. */
export async function openPdf(bytes: Uint8Array) {
  // pdf.js takes ownership of the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  return {
    pageCount: pdf.numPages,
    /** Renders a 1-based page to PNG bytes. */
    async renderPage(pageNumber: number): Promise<Uint8Array> {
      const png = await renderPageAsImage(pdf, pageNumber, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: RENDER_SCALE,
      });
      return new Uint8Array(png);
    },
  };
}
