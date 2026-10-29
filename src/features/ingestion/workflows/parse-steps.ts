import "server-only";
import {
  pageCallSettings,
  pageMessages,
  pageResultSchema,
  type PageUnit,
} from "@/features/ingestion/ai/page-units";
import { missingPages } from "@/features/ingestion/domain/missing-pages";
import {
  languageTag,
  mostCommonLanguage,
  overlayPages,
} from "@/features/ingestion/domain/pages";
import {
  dailyLimitReason,
  fileUnreadableReason,
  parseFailureError,
} from "@/features/ingestion/domain/parse-failure";
import type { PageSkip } from "@/features/ingestion/types";
import {
  openPdf,
  type OpenedPdf,
} from "@/features/ingestion/workflows/page-images";
import { meteredGenerate } from "@/features/usage/server";
import { getAiEnv } from "@/lib/ai/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The steps of a Material parse (`parse-material.ts`). Each runs on the
 * admin client, since no Student is signed in, and so scopes every query to
 * the Material and its owner itself. Each step starts with `loadMaterial`,
 * which sets the Material's heartbeat, and does nothing when it is gone.
 */

const BUCKET = MATERIALS_BUCKET;

/** Postgres error code of a row that points at a deleted parent. */
const FOREIGN_KEY_VIOLATION = "23503";

/** Postgres error code of a row that is there already. */
const UNIQUE_VIOLATION = "23505";

/** The most pages one read step reads. */
export const PAGES_PER_STEP = 8;

/**
 * How long after its start a read step may still start a page call. Later
 * pages are left to the next step, so a step ends within Vercel Hobby's
 * 300-second limit even at MiMo's pace.
 */
const CALL_WINDOW_MS = 150_000;

/** Why a parse stopped, for the Student. */
export type ParseOutcome = { ok: true } | { ok: false; reason: string };

/**
 * What a read step did: the pages it left for the next step, or null when
 * the Material is gone; or why the parse stops.
 */
export type ReadOutcome =
  { ok: true; left: number[] | null } | { ok: false; reason: string };

type ParseMaterialRow = {
  id: string;
  owner: string;
  course_id: string;
  media_type: string;
  storage_path: string;
};

/**
 * Loads the Material for a parse step and sets its heartbeat, so
 * `queue_material_parse` sees the parse alive. Null when it is gone.
 */
export async function loadMaterial(
  supabase: AdminSupabase,
  materialId: string,
): Promise<ParseMaterialRow | null> {
  const { data, error } = await supabase
    .from("materials")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", materialId)
    .select("id, owner, course_id, media_type, storage_path")
    .maybeSingle();
  if (error) failed("Loading the Material", error);
  return data;
}

async function download(supabase: AdminSupabase, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) failed(`Reading ${path}`, error);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Opens a PDF Material. A missing file or one that is no readable PDF fails
 * with the file's reason for the Student; a Storage failure does not.
 */
async function openMaterialPdf(supabase: AdminSupabase, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error?.message === "Object not found") {
    throw parseFailureError(fileUnreadableReason);
  }
  if (error) failed(`Reading ${path}`, error);
  const bytes = new Uint8Array(await data.arrayBuffer());
  try {
    return await openPdf(bytes);
  } catch {
    throw parseFailureError(fileUnreadableReason);
  }
}

/** The page numbers of the Material's stored page results. */
async function storedPageNumbers(
  supabase: AdminSupabase,
  materialId: string,
): Promise<number[]> {
  const { data, error } = await supabase
    .from("material_pages")
    .select("page_number")
    .eq("material_id", materialId);
  if (error) failed("Loading the page results", error);
  return data.map((page) => page.page_number);
}

/** One stored page: read, with its units and language, or skipped. */
type PageRow =
  | { pageNumber: number; units: PageUnit[]; language: string | null }
  | { pageNumber: number; skipped: PageSkip };

/**
 * Stores a page's result. False when the Material was deleted meanwhile;
 * a page stored already, by an earlier attempt, stays as it is.
 */
async function storePage(
  supabase: AdminSupabase,
  material: ParseMaterialRow,
  page: PageRow,
): Promise<boolean> {
  const stored = await supabase.from("material_pages").insert({
    owner: material.owner,
    material_id: material.id,
    page_number: page.pageNumber,
    ...("skipped" in page
      ? { units: [], skipped: page.skipped }
      : { units: page.units, language: page.language }),
  });
  if (stored.error?.code === FOREIGN_KEY_VIOLATION) return false;
  if (stored.error && stored.error.code !== UNIQUE_VIOLATION) {
    failed(`Storing page ${page.pageNumber}`, stored.error);
  }
  return true;
}

/**
 * Opens the Material, records its page count and stores its slide overlays
 * as skipped. The pages without a stored result are returned for reading,
 * in order; `pages` limits them to a selection (the parse smoke check).
 * Null when the Material is gone, also when it went meanwhile.
 */
export async function preparePages(
  materialId: string,
  pages?: readonly number[],
): Promise<number[] | null> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return null;
  // Out of `queued` at once, where Parse is offered when a start failed.
  const started = await supabase
    .from("materials")
    .update({ parse_status: "parsing", parse_failure: null })
    .eq("id", materialId);
  if (started.error) failed("Starting the parse", started.error);
  const stored = await storedPageNumbers(supabase, materialId);

  let pageCount = 1;
  let overlays: number[] = [];
  // An image is its own one page, without a text layer.
  if (material.media_type === "application/pdf") {
    const pdf = await openMaterialPdf(supabase, material.storage_path);
    pageCount = pdf.pageCount;
    overlays = overlayPages(await pdf.pageTexts());
  }
  const selected = (page: number) => !pages || pages.includes(page);
  for (const pageNumber of overlays) {
    if (stored.includes(pageNumber) || !selected(pageNumber)) continue;
    const kept = await storePage(supabase, material, {
      pageNumber,
      skipped: "overlay",
    });
    if (!kept) return null;
    stored.push(pageNumber);
  }
  const toRead = missingPages(pageCount, stored).filter(selected);

  const { data, error } = await supabase
    .from("materials")
    .update({
      parse_status: "parsing",
      pages_total: pageCount,
      pages_done: pageCount - missingPages(pageCount, stored).length,
      parse_failure: null,
    })
    .eq("id", materialId)
    .select("id");
  if (error) failed("Starting the parse", error);
  return data.length === 0 ? null : toRead;
}

/** A page call that failed for good, after the AI SDK's retries. */
class PageCallFailed extends Error {}

/** Where a read step gets its pages' images and text from. */
type PageSource = {
  /** The page's image, or null when it is blank. */
  image(pageNumber: number): Promise<{
    bytes: Uint8Array;
    mediaType: string;
  } | null>;
  text(pageNumber: number): Promise<string | null>;
};

async function pageSource(
  supabase: AdminSupabase,
  material: ParseMaterialRow,
): Promise<PageSource> {
  if (material.media_type !== "application/pdf") {
    const bytes = await download(supabase, material.storage_path);
    return {
      image: async () => ({ bytes, mediaType: material.media_type }),
      text: async () => null,
    };
  }
  const pdf: OpenedPdf = await openMaterialPdf(supabase, material.storage_path);
  return {
    async image(pageNumber) {
      const page = await pdf.renderPage(pageNumber);
      return page.blank ? null : { bytes: page.jpeg, mediaType: "image/jpeg" };
    },
    text: (pageNumber) => pdf.pageText(pageNumber),
  };
}

/**
 * Reads up to PAGES_PER_STEP of the Material's pages with one vision call
 * each (task `ingest`), at most AI_CONCURRENCY at a time, opening the PDF
 * once. Each page is stored as it finishes: read, `blank` without a call, or
 * `unreadable` when its call fails for good, and the parse goes on. No call
 * starts after CALL_WINDOW_MS; the pages not started are left to the next
 * step. A reached Daily limit stops the parse.
 */
export async function readPages(
  materialId: string,
  pageNumbers: readonly number[],
): Promise<ReadOutcome> {
  "use step";
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return { ok: true, left: null };
  // A retried step reads the pages its earlier attempt stored no more.
  const stored = new Set(await storedPageNumbers(supabase, materialId));
  const queue = pageNumbers.filter((page) => !stored.has(page));
  const source = await pageSource(supabase, material);

  let started = 0;
  let limitReached = false;
  let gone = false;
  const read = async (pageNumber: number) => {
    const page = await readPage(supabase, material, source, pageNumber);
    if (page === "limit") {
      limitReached = true;
      return;
    }
    if (!(await storePage(supabase, material, page))) gone = true;
    else await recordProgress(supabase, materialId);
  };
  const worker = async () => {
    while (!limitReached && !gone) {
      if (started > 0 && Date.now() - startedAt > CALL_WINDOW_MS) return;
      const pageNumber = queue.shift();
      if (pageNumber === undefined) return;
      started += 1;
      await read(pageNumber);
    }
  };
  await Promise.all(
    Array.from({ length: getAiEnv().AI_CONCURRENCY }, () => worker()),
  );

  if (gone) return { ok: true, left: null };
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: queue };
}

/**
 * Reads one page: its result to store, or "limit" when the Student's Daily
 * limit is reached.
 */
async function readPage(
  supabase: AdminSupabase,
  material: ParseMaterialRow,
  source: PageSource,
  pageNumber: number,
): Promise<PageRow | "limit"> {
  const image = await source.image(pageNumber);
  if (!image) return { pageNumber, skipped: "blank" };
  const text = await source.text(pageNumber);
  const unreadable = (error: unknown): PageRow => {
    console.error(`The page call for page ${pageNumber} failed:`, error);
    return { pageNumber, skipped: "unreadable" };
  };

  let result: Awaited<ReturnType<typeof meteredGenerate>>;
  try {
    result = await meteredGenerate(
      supabase,
      {
        studentId: material.owner,
        task: "ingest",
        traceName: "parse-page",
        callFailed: (error) => {
          throw new PageCallFailed(String(error), { cause: error });
        },
      },
      {
        ...pageCallSettings(),
        messages: pageMessages(image.bytes, image.mediaType, text),
      },
    );
  } catch (error) {
    // Any other failure, such as the database's, is the step's.
    if (error instanceof PageCallFailed) return unreadable(error.cause);
    throw error;
  }
  if (!result) return "limit";
  try {
    const { language, units } = pageResultSchema.parse(result.output);
    return { pageNumber, units, language: languageTag(language) };
  } catch (error) {
    return unreadable(error);
  }
}

/** Sets the Material's progress to the count of its stored page results. */
async function recordProgress(
  supabase: AdminSupabase,
  materialId: string,
): Promise<void> {
  const done = await storedPageNumbers(supabase, materialId);
  const progress = await supabase
    .from("materials")
    .update({
      pages_done: done.length,
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", materialId);
  if (progress.error) failed("Recording the progress", progress.error);
}

/**
 * Marks the Material parsed, with the most common language of its pages:
 * the last step of a parse.
 */
export async function markParsed(materialId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const pages = await supabase
    .from("material_pages")
    .select("language")
    .eq("material_id", materialId)
    .order("page_number");
  if (pages.error) failed("Loading the page languages", pages.error);
  const { error } = await supabase
    .from("materials")
    .update({
      parse_status: "parsed",
      parse_failure: null,
      language: mostCommonLanguage(pages.data.map((page) => page.language)),
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", materialId);
  if (error) failed("Finishing the parse", error);
}

/** Marks the parse failed with a reason for the Student. */
export async function failParse(
  materialId: string,
  reason: string,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("materials")
    .update({ parse_status: "failed", parse_failure: reason })
    .eq("id", materialId);
  if (error) failed("Recording the failed parse", error);
}
