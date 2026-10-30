import "server-only";
import path from "node:path";
import {
  createIsomorphicCanvasFactory,
  definePDFJSModule,
  getDocumentProxy,
} from "unpdf";
import type { OutlineEntry } from "@/features/ingestion/domain/chapters";
import { isBlankRender } from "@/features/ingestion/domain/pages";
import {
  fileUnreadableReason,
  parseFailureError,
} from "@/features/ingestion/domain/parse-failure";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/** A rendered page's long edge, in pixels. */
const LONG_EDGE_PX = 2000;

/** JPEG quality of a rendered page, 0 to 100. */
const JPEG_QUALITY = 85;

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

/** The app's own canvas package, which `next.config.ts` ships to the function. */
const canvasImport = () => import("@napi-rs/canvas");

/** A page rendered for its page call. */
export type RenderedPage = {
  /** JPEG bytes, with the long edge at 2,000 pixels. */
  jpeg: Uint8Array;
  /** Almost all white: nothing for a page call to read. */
  blank: boolean;
};

/** An opened PDF, to count, read and render its pages. */
export async function openPdf(bytes: Uint8Array) {
  await pdfjsReady;
  // pdf.js would otherwise create canvases (masks, patterns) with its own
  // `require("@napi-rs/canvas")` from the pnpm store, which the deployed
  // function lacks (docs/agents/notes/pdf-page-rendering.md).
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const { createCanvas } = await canvasImport();
  // pdf.js takes ownership of the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    // Draw glyphs from the bundled fonts, the same on every machine.
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS_PATH,
    cMapUrl: CMAPS_PATH,
    cMapPacked: true,
    CanvasFactory,
  });

  /** A 1-based page's text layer, empty when it has none. */
  async function pageText(pageNumber: number): Promise<string> {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items
      .map((item) =>
        "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "",
      )
      .join("");
  }

  /** The 1-based page an outline item points at; null when it points nowhere. */
  async function outlinePage(dest: unknown): Promise<number | null> {
    try {
      const target =
        typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(target)) return null;
      const ref: unknown = target[0];
      if (typeof ref === "number") return ref + 1;
      return (await pdf.getPageIndex(ref as never)) + 1;
    } catch {
      return null;
    }
  }

  return {
    pageCount: pdf.numPages,
    pageText,
    /**
     * The PDF's outline (bookmarks) in document order, each entry with its
     * level (1 at the top) and page; entries that point at no page are left
     * out. Empty without an outline.
     */
    async outline(): Promise<OutlineEntry[]> {
      const entries: OutlineEntry[] = [];
      type Item = { title: string; dest: unknown; items: Item[] };
      const walk = async (items: Item[], level: number) => {
        for (const item of items) {
          const page = await outlinePage(item.dest);
          const title = item.title.trim();
          if (page !== null && title) entries.push({ title, level, page });
          await walk(item.items, level + 1);
        }
      };
      await walk(((await pdf.getOutline()) ?? []) as Item[], 1);
      return entries;
    },
    /** Every page's text layer, in page order. */
    async pageTexts(): Promise<string[]> {
      const texts: string[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        texts.push(await pageText(page));
      }
      return texts;
    },
    /** Renders a 1-based page as JPEG, and tells whether it is blank. */
    async renderPage(pageNumber: number): Promise<RenderedPage> {
      const page = await pdf.getPage(pageNumber);
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: LONG_EDGE_PX / Math.max(width, height),
      });
      const canvas = createCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height),
      );
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const jpeg = await canvas.encode("jpeg", JPEG_QUALITY);
      page.cleanup();
      return { jpeg: new Uint8Array(jpeg), blank: isBlankRender(pixels.data) };
    },
  };
}

export type OpenedPdf = Awaited<ReturnType<typeof openPdf>>;

/**
 * Opens a PDF Material from Storage. A missing file or one that is no
 * readable PDF fails with the file's reason for the Student; a Storage
 * failure does not.
 */
export async function openMaterialPdf(
  supabase: AdminSupabase,
  storagePath: string,
): Promise<OpenedPdf> {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .download(storagePath);
  if (error?.message === "Object not found") {
    throw parseFailureError(fileUnreadableReason);
  }
  if (error) failed(`Reading ${storagePath}`, error);
  const bytes = new Uint8Array(await data.arrayBuffer());
  try {
    return await openPdf(bytes);
  } catch {
    throw parseFailureError(fileUnreadableReason);
  }
}
