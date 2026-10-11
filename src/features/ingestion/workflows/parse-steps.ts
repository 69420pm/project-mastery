import "server-only";
import { generateText } from "ai";
import {
  pageCallSettings,
  pageMessages,
  pageResultSchema,
  storedUnitsSchema,
} from "@/features/ingestion/ai/page-units";
import { isDailyQuotaError } from "@/features/ingestion/ai/daily-quota";
import { missingPages } from "@/features/ingestion/domain/missing-pages";
import { chunksFromPages } from "@/features/ingestion/domain/page-chunks";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import { openPdf } from "@/features/ingestion/workflows/page-images";
import { storeFigures } from "@/features/ingestion/workflows/store-figures";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { answeringModel } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * The steps of a Material parse (`parse-material.ts`). Each runs on the
 * admin client, since no Student is signed in, and so scopes every query to
 * the Material and its owner itself. Each step loads the Material first and
 * does nothing when it is gone.
 */

/** The Storage bucket of Materials and their page images. */
const BUCKET = "course-files";

/** One page of a Material, as the page calls read it. */
export type PreparedPage = {
  pageNumber: number;
  /** The page image in the bucket. */
  imagePath: string;
  mediaType: string;
};

/** Why a parse stopped, for the Student. */
export type ParseOutcome = { ok: true } | { ok: false; reason: string };

type ParseMaterialRow = {
  id: string;
  owner: string;
  course_id: string;
  media_type: string;
  storage_path: string;
};

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

async function loadMaterial(
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

/** Where a rendered PDF page is stored: under the Material's own path. */
function pageImagePath(storagePath: string, pageNumber: number): string {
  return `${storagePath}/pages/${pageNumber}.png`;
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
 * page result are returned for reading: a PDF's are rendered to PNGs and
 * stored under the Material's path, and an image is its own one page. Null
 * when the Material is gone, also when it went while its pages rendered.
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

  let pages: PreparedPage[];
  let pageCount = 1;
  if (material.media_type === "application/pdf") {
    const pdf = await openPdf(await download(supabase, material.storage_path));
    pageCount = pdf.pageCount;
    pages = [];
    for (const pageNumber of missingPages(pdf.pageCount, stored)) {
      const imagePath = pageImagePath(material.storage_path, pageNumber);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(imagePath, await pdf.renderPage(pageNumber), {
          contentType: "image/png",
          upsert: true,
        });
      if (error) fail(`Storing page ${pageNumber}`, error);
      pages.push({ pageNumber, imagePath, mediaType: "image/png" });
    }
  } else {
    pages = missingPages(1, stored).map((pageNumber) => ({
      pageNumber,
      imagePath: material.storage_path,
      mediaType: material.media_type,
    }));
  }

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
  if (data.length === 0) {
    // Deleted while its pages rendered.
    await removeFiles(
      supabase,
      pages.map((page) => page.imagePath),
    );
    return null;
  }
  return pages;
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

  const image = await download(supabase, page.imagePath);
  const settings = pageCallSettings();
  const result = await withTraceAttributes(
    { userId: studentId, traceName: "parse-page" },
    () =>
      generateText({
        ...settings,
        messages: pageMessages(image, page.mediaType),
      }),
  ).catch(dailyQuotaAsNull);
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

  const units = await storeFigures(
    supabase,
    {
      bucket: BUCKET,
      storagePath: material.storage_path,
      pageNumber: page.pageNumber,
      pageImagePath: page.imagePath,
      pageImage: image,
    },
    pageResultSchema.parse(result.output).units,
  );
  const stored = await supabase.from("material_pages").insert({
    owner: studentId,
    material_id: materialId,
    page_number: page.pageNumber,
    image_path: page.imagePath,
    units,
  });
  // 23503: the Material was deleted during the call, so stop quietly, and
  // remove the crops stored after its files were removed.
  if (stored.error?.code === FOREIGN_KEY_VIOLATION) {
    await removeFiles(
      supabase,
      units.flatMap((unit) => unit.figure?.cropPath ?? []),
    );
    return { ok: true };
  }
  if (stored.error) fail(`Storing page ${page.pageNumber}`, stored.error);
  return recordProgress(supabase, materialId);
}

const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Removes files a step stored for a Material that was deleted meanwhile,
 * since the delete may have removed its files before the step stored them.
 */
async function removeFiles(
  supabase: AdminSupabase,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) fail("Removing the files of a deleted Material", error);
}

/** A model call's error, or null for a used-up daily quota of the provider. */
function dailyQuotaAsNull(error: unknown): null {
  if (isDailyQuotaError(error)) return null;
  throw error;
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

/**
 * Writes the Material's chunks from its stored page results, replacing any
 * earlier ones, and marks it parsed.
 */
export async function writeChunks(materialId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return;

  const pages = await supabase
    .from("material_pages")
    .select("page_number, units")
    .eq("material_id", materialId);
  if (pages.error) fail("Loading the page results", pages.error);
  const chunks = chunksFromPages(
    pages.data.map((page) => ({
      pageNumber: page.page_number,
      units: storedUnitsSchema.parse(page.units),
    })),
  );

  const removed = await supabase
    .from("chunks")
    .delete()
    .eq("material_id", materialId);
  if (removed.error) fail("Replacing the chunks", removed.error);
  if (chunks.length > 0) {
    const inserted = await supabase.from("chunks").insert(
      chunks.map((chunk) => ({
        owner: material.owner,
        course_id: material.course_id,
        material_id: materialId,
        position: chunk.position,
        page_from: chunk.pageFrom,
        page_to: chunk.pageTo,
        label: chunk.label,
        markdown: chunk.markdown,
        figure: chunk.figure,
        exercise_number: chunk.exerciseNumber,
        points: chunk.points,
      })),
    );
    if (inserted.error) fail("Storing the chunks", inserted.error);
  }

  const { error } = await supabase
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
