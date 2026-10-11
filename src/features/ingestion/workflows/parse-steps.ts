import "server-only";
import { generateText } from "ai";
import {
  pageCallSettings,
  pageMessages,
  pageResultSchema,
} from "@/features/ingestion/ai/page-units";
import { openPdf } from "@/features/ingestion/workflows/page-images";
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

export const dailyLimitReason = "Daily limit reached";

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

/** Where a rendered PDF page is stored: under the Material's own path. */
function pageImagePath(storagePath: string, pageNumber: number): string {
  return `${storagePath}/pages/${pageNumber}.png`;
}

/**
 * Opens the Material and records its page count: a PDF's pages are rendered
 * to PNGs and stored under the Material's path, and an image is its own one
 * page. Null when the Material is gone.
 */
export async function preparePages(
  materialId: string,
): Promise<PreparedPage[] | null> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return null;

  let pages: PreparedPage[];
  if (material.media_type === "application/pdf") {
    const pdf = await openPdf(await download(supabase, material.storage_path));
    pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.pageCount; pageNumber++) {
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
    pages = [
      {
        pageNumber: 1,
        imagePath: material.storage_path,
        mediaType: material.media_type,
      },
    ];
  }

  const { error } = await supabase
    .from("materials")
    .update({
      parse_status: "parsing",
      pages_total: pages.length,
      parse_failure: null,
    })
    .eq("id", materialId);
  if (error) fail("Starting the parse", error);
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
  );
  await recordAiUsage(
    supabase,
    {
      task: "ingest",
      modelId: answeringModel(settings, result.response.modelId),
      usage: tokenUsage(result.usage),
    },
    { studentId },
  );

  const { units } = pageResultSchema.parse(result.output);
  const stored = await supabase.from("material_pages").insert({
    owner: studentId,
    material_id: materialId,
    page_number: page.pageNumber,
    image_path: page.imagePath,
    units,
  });
  if (stored.error) fail(`Storing page ${page.pageNumber}`, stored.error);

  const done = await supabase
    .from("material_pages")
    .select("id")
    .eq("material_id", materialId);
  if (done.error) fail("Counting the parsed pages", done.error);
  const progress = await supabase
    .from("materials")
    .update({ pages_done: done.data.length })
    .eq("id", materialId);
  if (progress.error) fail("Recording the progress", progress.error);
  return { ok: true };
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
