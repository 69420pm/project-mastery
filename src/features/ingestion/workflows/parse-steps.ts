import "server-only";
import { generateText } from "ai";
import {
  pageCallSettings,
  pageMessages,
  pageResultSchema,
} from "@/features/ingestion/ai/page-units";
import { isDailyQuotaError } from "@/features/ingestion/ai/daily-quota";
import { usableBox } from "@/features/ingestion/domain/figure-box";
import { missingPages } from "@/features/ingestion/domain/missing-pages";
import {
  dailyLimitReason,
  fileUnreadableReason,
  pageUnreadableReason,
  parseFailureError,
} from "@/features/ingestion/domain/parse-failure";
import { openPdf } from "@/features/ingestion/workflows/page-images";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { answeringModel } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATERIALS_BUCKET } from "@/lib/supabase/buckets";
import type { AdminSupabase } from "@/lib/supabase/types";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * The steps of a Material parse (`parse-material.ts`). Each runs on the
 * admin client, since no Student is signed in, and so scopes every query to
 * the Material and its owner itself. Each step loads the Material first and
 * does nothing when it is gone.
 */

const BUCKET = MATERIALS_BUCKET;

/** Postgres error code of a row that points at a deleted parent. */
const FOREIGN_KEY_VIOLATION = "23503";

/** One page of a Material that still has to be read. */
export type PreparedPage = { pageNumber: number };

/** Why a parse stopped, for the Student. */
export type ParseOutcome = { ok: true } | { ok: false; reason: string };

type ParseMaterialRow = {
  id: string;
  owner: string;
  course_id: string;
  media_type: string;
  storage_path: string;
};

export function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

export async function loadMaterial(
  supabase: AdminSupabase,
  materialId: string,
): Promise<ParseMaterialRow | null> {
  const { data, error } = await supabase
    .from("materials")
    .select("id, owner, course_id, media_type, storage_path")
    .eq("id", materialId)
    .maybeSingle();
  if (error) fail("Loading the Material", error);
  return data;
}

async function download(supabase: AdminSupabase, path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) fail(`Reading ${path}`, error);
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
  if (error) fail(`Reading ${path}`, error);
  const bytes = new Uint8Array(await data.arrayBuffer());
  try {
    return await openPdf(bytes);
  } catch {
    throw parseFailureError(fileUnreadableReason);
  }
}

/**
 * The image a page call reads: a PDF page rendered from the Material's file,
 * or the uploaded image itself. Rendered afresh by each page step and never
 * stored, so a PDF is stored once.
 */
async function pageImage(
  supabase: AdminSupabase,
  material: ParseMaterialRow,
  pageNumber: number,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (material.media_type !== "application/pdf") {
    return {
      bytes: await download(supabase, material.storage_path),
      mediaType: material.media_type,
    };
  }
  const pdf = await openMaterialPdf(supabase, material.storage_path);
  return { bytes: await pdf.renderPage(pageNumber), mediaType: "image/png" };
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
  if (error) fail("Loading the page results", error);
  return data.map((page) => page.page_number);
}

/**
 * Opens the Material and records its page count. The pages without a stored
 * page result are returned for reading. Null when the Material is gone, also
 * when it went meanwhile.
 */
export async function preparePages(
  materialId: string,
): Promise<PreparedPage[] | null> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return null;
  // Out of `queued` at once, where Parse is offered when a start failed.
  const started = await supabase
    .from("materials")
    .update({ parse_status: "parsing", parse_failure: null })
    .eq("id", materialId);
  if (started.error) fail("Starting the parse", started.error);
  const stored = await storedPageNumbers(supabase, materialId);

  // An image is its own one page.
  const pageCount =
    material.media_type === "application/pdf"
      ? (await openMaterialPdf(supabase, material.storage_path)).pageCount
      : 1;
  const pages = missingPages(pageCount, stored).map((pageNumber) => ({
    pageNumber,
  }));

  const { data, error } = await supabase
    .from("materials")
    .update({
      parse_status: "parsing",
      pages_total: pageCount,
      pages_done: pageCount - pages.length,
      parse_failure: null,
    })
    .eq("id", materialId)
    .select("id");
  if (error) fail("Starting the parse", error);
  return data.length === 0 ? null : pages;
}

/**
 * One vision call for a page (task `ingest`), after checking the Student's
 * Daily limit. Stores the page's units and advances the Material's progress.
 */
export async function readPage(
  materialId: string,
  page: PreparedPage,
): Promise<ParseOutcome> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return { ok: true };
  const studentId = material.owner;
  // A retried step whose earlier attempt stored the page reads it no more.
  if ((await storedPageNumbers(supabase, materialId)).includes(page.pageNumber))
    return recordProgress(supabase, materialId);

  const dailyLimit = await checkDailyLimit(supabase, { studentId });
  if (dailyLimit.level === "reached") {
    return { ok: false, reason: dailyLimitReason };
  }

  const image = await pageImage(supabase, material, page.pageNumber);
  const settings = pageCallSettings();
  const result = await withTraceAttributes(
    { userId: studentId, traceName: "parse-page" },
    () =>
      generateText({
        ...settings,
        messages: pageMessages(image.bytes, image.mediaType),
      }),
  ).catch((error) => pageCallFailed(error, page.pageNumber));
  if (!result) return { ok: false, reason: dailyLimitReason };
  await recordAiUsage(
    supabase,
    {
      task: "ingest",
      modelId: answeringModel(settings, result.response.modelId),
      usage: tokenUsage(result.usage),
    },
    { studentId },
  );

  const units = pageUnits(() => result.output, page.pageNumber).map((unit) =>
    unit.figure
      ? { ...unit, figure: { ...unit.figure, box: usableBox(unit.figure.box) } }
      : unit,
  );
  const stored = await supabase.from("material_pages").insert({
    owner: studentId,
    material_id: materialId,
    page_number: page.pageNumber,
    units,
  });
  // 23503: the Material was deleted during the call, so stop quietly.
  if (stored.error?.code === FOREIGN_KEY_VIOLATION) return { ok: true };
  if (stored.error) fail(`Storing page ${page.pageNumber}`, stored.error);
  return recordProgress(supabase, materialId);
}

/** A model call's error, or null for a used-up daily quota of the provider. */
export function dailyQuotaAsNull(error: unknown): null {
  if (isDailyQuotaError(error)) return null;
  throw error;
}

/**
 * A failed page call: null for a used-up daily quota of the provider, and
 * otherwise the page's reason for the Student once the step's retries are
 * spent.
 */
function pageCallFailed(error: unknown, pageNumber: number): null {
  if (isDailyQuotaError(error)) return null;
  console.error(`The page call for page ${pageNumber} failed:`, error);
  throw parseFailureError(pageUnreadableReason(pageNumber));
}

/** The units of a page call's output, or the page's reason when it has none. */
function pageUnits(output: () => unknown, pageNumber: number) {
  try {
    return pageResultSchema.parse(output()).units;
  } catch (error) {
    console.error(`The page call for page ${pageNumber} gave no units:`, error);
    throw parseFailureError(pageUnreadableReason(pageNumber));
  }
}

/** Sets the Material's progress to the count of its stored page results. */
async function recordProgress(
  supabase: AdminSupabase,
  materialId: string,
): Promise<ParseOutcome> {
  const done = await storedPageNumbers(supabase, materialId);
  const progress = await supabase
    .from("materials")
    .update({ pages_done: done.length })
    .eq("id", materialId);
  if (progress.error) fail("Recording the progress", progress.error);
  return { ok: true };
}

/** Marks the Material parsed: the last step of a parse. */
export async function markParsed(materialId: string): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("materials")
    .update({ parse_status: "parsed", parse_failure: null })
    .eq("id", materialId);
  if (error) fail("Finishing the parse", error);
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
  if (error) fail("Recording the failed parse", error);
}
