import "server-only";
import path from "node:path";
import { definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf";

/** Rendering scale: a US Letter page becomes 1224×1584 pixels. */
const RENDER_SCALE = 2;

/**
 * Where pdf.js reads the fonts and character maps it needs for text. A plain
 * path with a trailing slash: pdf.js reads it with `fs`, and a `file://` URL
 * fails there. `next.config.ts` ships these folders to the deployed function.
 */
const PDFJS_DIR = path.join(process.cwd(), "node_modules/pdfjs-dist");
const STANDARD_FONTS_PATH = path.join(PDFJS_DIR, "standard_fonts/");
const CMAPS_PATH = path.join(PDFJS_DIR, "cmaps/");

/**
 * unpdf's bundled pdf.js loads fonts with `fetch()`, which cannot read local
 * files, and falls back to system fonts. A deployed function has none, so text
 * vanished from the page images. The installed pdfjs-dist reads them from disk.
 */
const pdfjsReady = definePDFJSModule(
  () => import("pdfjs-dist/legacy/build/pdf.mjs"),
);

/** An opened PDF, to count its pages and render them one by one. */
export async function openPdf(bytes: Uint8Array) {
  await pdfjsReady;
  // pdf.js takes ownership of the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    // Draw glyphs from the bundled fonts, the same on every machine.
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS_PATH,
    cMapUrl: CMAPS_PATH,
    cMapPacked: true,
  });
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
