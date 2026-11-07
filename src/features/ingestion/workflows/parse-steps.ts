import "server-only";
import {
  batchCallSettings,
  batchMessages,
  batchResultSchema,
  storedUnitsSchema,
  type BatchPage,
  type PageUnit,
} from "@/features/ingestion/ai/page-units";
import { missingPages } from "@/features/ingestion/domain/missing-pages";
import {
  PAGES_PER_BATCH,
  pageBatches,
  uncoveredPages,
  unitsOnPages,
} from "@/features/ingestion/domain/page-batches";
import { overlayPages } from "@/features/ingestion/domain/pages";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import type { PageSkip } from "@/features/ingestion/types";
import {
  openMaterialPdf,
  type OpenedPdf,
} from "@/features/ingestion/workflows/page-images";
import {
  meteredStream,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { callFits } from "@/lib/ai/call-timeout";
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

/** The most pages one read step reads: four batches. */
export const PAGES_PER_STEP = 4 * PAGES_PER_BATCH;

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
  name: string;
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
    .select("id, owner, course_id, name, media_type, storage_path")
    .maybeSingle();
  if (error) failed("Loading the Material", error);
  return data;
}

/**
 * Whether the Material has chunks. They are written in one transaction
 * after every page is read, so existing ones are complete: a parse started
 * again after a failed embed keeps them, their Outline and their vectors.
 */
export async function hasChunks(
  supabase: AdminSupabase,
  materialId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("chunks")
    .select("id")
    .eq("material_id", materialId)
    .limit(1);
  if (error) failed("Loading the chunks", error);
  return data.length > 0;
}

/** The units of the Material's read pages, in reading order. */
export async function loadUnits(
  supabase: AdminSupabase,
  materialId: string,
): Promise<PageUnit[]> {
  const { data, error } = await supabase
    .from("material_pages")
    .select("page_number, units")
    .eq("material_id", materialId)
    .order("page_number");
  if (error) failed("Loading the page results", error);
  return data.flatMap((page) => storedUnitsSchema.parse(page.units));
}

async function download(supabase: AdminSupabase, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) failed(`Reading ${path}`, error);
  return new Uint8Array(await data.arrayBuffer());
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

/** One stored page: read, with the units that start on it, or skipped. */
type PageRow =
  | { pageNumber: number; units: PageUnit[] }
  | { pageNumber: number; skipped: PageSkip };

/**
 * The units without NUL characters. A model can emit one (a garbled text
 * layer's glyph), and Postgres rejects it in jsonb ("unsupported Unicode
 * escape sequence"), which failed the whole read step.
 */
function withoutNul(units: PageUnit[]): PageUnit[] {
  return units.map((unit) => ({
    ...unit,
    markdown: unit.markdown.replaceAll("\u0000", ""),
  }));
}

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
      : { units: withoutNul(page.units) }),
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
 * Reads up to PAGES_PER_STEP of the Material's pages, opening the PDF once.
 * A blank page is stored `blank` without a call; the others are read in
 * batches of up to PAGES_PER_BATCH with one streamed vision call each (task
 * `ingest`), at most AI_CONCURRENCY at a time. A batch's pages are stored as
 * it finishes, each with the units that start on it; a batch whose call
 * fails for good is read again page by page, and a page that still fails is
 * stored `unreadable`, so the parse goes on. A page that no unit covers is
 * read again alone, and stored `uncovered` when still none does. No call
 * starts that could run past the step's limit (`callFits`); the pages of
 * calls not started are left to the next step. A reached Daily limit stops
 * the parse.
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
  const source = await pageSource(supabase, material);

  const toRead = new Map<number, BatchPage>();
  for (const pageNumber of pageNumbers) {
    if (stored.has(pageNumber)) continue;
    const image = await source.image(pageNumber);
    if (image) {
      toRead.set(pageNumber, {
        pageNumber,
        image: image.bytes,
        mediaType: image.mediaType,
        text: await source.text(pageNumber),
      });
      continue;
    }
    const blank = { pageNumber, skipped: "blank" as const };
    if (!(await storePage(supabase, material, blank))) {
      return { ok: true, left: null };
    }
    await recordProgress(supabase, materialId);
  }
  const queue = pageBatches([...toRead.keys()]).map((batch) =>
    batch.map((pageNumber) => toRead.get(pageNumber)!),
  );

  let limitReached = false;
  let gone = false;
  const leftOver: number[] = [];
  const read = async (batch: BatchPage[]) => {
    const { pages, limit, left } = await readBatch(
      supabase,
      material,
      batch,
      startedAt,
    );
    if (limit) limitReached = true;
    leftOver.push(...left);
    for (const page of pages) {
      if (!(await storePage(supabase, material, page))) {
        gone = true;
        return;
      }
    }
    if (pages.length > 0) await recordProgress(supabase, materialId);
  };
  const worker = async () => {
    while (!limitReached && !gone && callFits(startedAt)) {
      const batch = queue.shift();
      if (batch === undefined) return;
      await read(batch);
    }
  };
  await Promise.all(
    Array.from({ length: getAiEnv().AI_CONCURRENCY }, () => worker()),
  );

  if (gone) return { ok: true, left: null };
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return {
    ok: true,
    left: [
      ...leftOver,
      ...queue.flatMap((batch) => batch.map((page) => page.pageNumber)),
    ].toSorted((a, b) => a - b),
  };
}

readPages.maxRetries = RATE_LIMITED_STEP_RETRIES;

/**
 * Reads one batch: the results of its pages read so far, whether the
 * Student's Daily limit stopped it, and the pages left for the next step
 * because no call fits the step any more (`callFits` from `stepStartedAt`).
 * A batch whose call fails is read again page by page once; a page that
 * still fails is unreadable. A page of an answered batch that no unit
 * covers is read again alone once; a page still uncovered is stored so.
 */
async function readBatch(
  supabase: AdminSupabase,
  material: ParseMaterialRow,
  batch: BatchPage[],
  stepStartedAt: number,
): Promise<{ pages: PageRow[]; limit: boolean; left: number[] }> {
  const placed = (pages: BatchPage[], units: PageUnit[]) =>
    unitsOnPages(
      units,
      pages.map((page) => page.pageNumber),
    );
  const rows = (onPages: Map<number, PageUnit[]>): PageRow[] =>
    [...onPages].map(([pageNumber, units]) => ({ pageNumber, units }));

  let context = await lastUnitBefore(supabase, material.id, batch[0]!);
  const units = await callBatch(supabase, material, batch, context);
  if (units === "limit") return { pages: [], limit: true, left: [] };

  const pages: PageRow[] = [];
  if (units === "failed") {
    for (const [index, page] of batch.entries()) {
      if (!callFits(stepStartedAt)) {
        const left = batch.slice(index).map((p) => p.pageNumber);
        return { pages, limit: false, left };
      }
      const single = await callBatch(supabase, material, [page], context);
      if (single === "limit") return { pages, limit: true, left: [] };
      if (single === "failed") {
        pages.push({ pageNumber: page.pageNumber, skipped: "unreadable" });
        context = null;
      } else {
        pages.push(...rows(placed([page], single)));
        context = single.at(-1) ?? null;
      }
    }
    return { pages, limit: false, left: [] };
  }

  const onPages = placed(batch, units);
  const uncovered = new Set(
    uncoveredPages(
      [...onPages.values()].flat(),
      batch.map((page) => page.pageNumber),
    ),
  );
  const left: number[] = [];
  for (const page of batch) {
    const own = onPages.get(page.pageNumber) ?? [];
    if (!uncovered.has(page.pageNumber)) {
      pages.push({ pageNumber: page.pageNumber, units: own });
      context = own.at(-1) ?? context;
      continue;
    }
    if (!callFits(stepStartedAt)) {
      left.push(page.pageNumber);
      continue;
    }
    const single = await callBatch(supabase, material, [page], context);
    if (single === "limit") return { pages, limit: true, left: [] };
    const again = single === "failed" ? [] : single;
    const onPage = placed([page], again).get(page.pageNumber) ?? [];
    if (uncoveredPages(onPage, [page.pageNumber]).length > 0) {
      pages.push({ pageNumber: page.pageNumber, skipped: "uncovered" });
    } else {
      pages.push({ pageNumber: page.pageNumber, units: onPage });
      context = onPage.at(-1) ?? context;
    }
  }
  return { pages, limit: false, left };
}

/**
 * One streamed batch call: its units, "failed" when the call fails for
 * good or gives no valid answer, or "limit" when the Student's Daily limit
 * is reached.
 */
async function callBatch(
  supabase: AdminSupabase,
  material: ParseMaterialRow,
  batch: BatchPage[],
  context: PageUnit | null,
): Promise<PageUnit[] | "failed" | "limit"> {
  const failedCall = (error: unknown) => {
    const pages = batch.map((page) => page.pageNumber).join(", ");
    console.error(`The batch call for pages ${pages} failed:`, error);
    return "failed" as const;
  };
  let result: Awaited<ReturnType<typeof meteredStream>>;
  try {
    result = await meteredStream(
      supabase,
      {
        studentId: material.owner,
        task: "ingest",
        traceName: "parse-batch",
        callFailed: (error) => {
          throw new PageCallFailed(String(error), { cause: error });
        },
      },
      { ...batchCallSettings(), messages: batchMessages(batch, context) },
    );
  } catch (error) {
    // Any other failure, such as the database's, is the step's.
    if (error instanceof PageCallFailed) return failedCall(error.cause);
    throw error;
  }
  if (!result) return "limit";
  try {
    return batchResultSchema.parse(await result.output).units;
  } catch (error) {
    return failedCall(error);
  }
}

/**
 * The last unit of the read pages right before a batch, as its context:
 * null when one of them is not stored yet, such as a page another batch of
 * the step still reads, or none has a unit.
 */
async function lastUnitBefore(
  supabase: AdminSupabase,
  materialId: string,
  first: BatchPage,
): Promise<PageUnit | null> {
  const { data, error } = await supabase
    .from("material_pages")
    .select("page_number, units")
    .eq("material_id", materialId)
    .lt("page_number", first.pageNumber)
    .order("page_number", { ascending: false })
    .limit(PAGES_PER_STEP);
  if (error) failed("Loading the page results", error);
  let expected = first.pageNumber - 1;
  for (const page of data) {
    if (page.page_number !== expected) return null;
    const last = storedUnitsSchema.parse(page.units).at(-1);
    if (last) return last;
    expected -= 1;
  }
  return null;
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

/** Marks the Material parsed: the last step of a parse. */
export async function markParsed(materialId: string): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("materials")
    .update({
      parse_status: "parsed",
      parse_failure: null,
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
