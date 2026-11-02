import "server-only";
import {
  outlineAnswer,
  outlineAnswerSchema,
  outlineCallSettings,
  outlineMessages,
  type OutlineAnswer,
  type OutlineInput,
} from "@/features/ingestion/ai/outline";
import type { PageUnit } from "@/features/ingestion/ai/page-units";
import { chunksFromUnits } from "@/features/ingestion/domain/chunk-joining";
import {
  chaptersFromPdfOutline,
  headingIds,
  outlineChapters,
} from "@/features/ingestion/domain/outline";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import { openMaterialPdf } from "@/features/ingestion/workflows/page-images";
import {
  hasChunks,
  loadMaterial,
  loadUnits,
} from "@/features/ingestion/workflows/parse-steps";
import {
  meteredStream,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/** How much of each page's start the structure call sees, in characters. */
const PAGE_START_CHARS = 80;

/**
 * What the Outline step decided: the Outline to cut the chunks by, null
 * when the Material is gone or has its chunks already; or why the parse
 * stops.
 */
export type OutlineOutcome =
  { ok: true; outline: OutlineAnswer | null } | { ok: false; reason: string };

/**
 * The Outline step of a parse (`parse-material.ts`), after every page is
 * read: one structure call (task `ingest`) over the Material's headings, the
 * starts of its pages and its PDF outline. When the call fails for good,
 * the Chapters come from the PDF outline, without language and notes; a
 * reached Daily limit stops the parse. `recorded` is used instead of the
 * call (the smoke checks' recorded pages).
 */
export async function outlineMaterial(
  materialId: string,
  recorded?: OutlineAnswer,
): Promise<OutlineOutcome> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material || (await hasChunks(supabase, materialId))) {
    return { ok: true, outline: null };
  }
  if (recorded) return { ok: true, outline: recorded };

  const units = await loadUnits(supabase, materialId);
  const pdf =
    material.media_type === "application/pdf"
      ? await openMaterialPdf(supabase, material.storage_path)
      : null;
  const pdfOutline = pdf ? await pdf.outline() : [];
  const input: OutlineInput = {
    name: material.name,
    pageCount: pdf?.pageCount ?? 1,
    pdfOutline,
    headings: [...headingIds(units)].map(([id, index]) => ({
      id,
      page: units[index]!.pageFrom,
      style: units[index]!.style,
      text: units[index]!.markdown,
    })),
    pageStarts: pageStarts(units),
  };

  const answer = await callOutline(supabase, material.owner, input);
  if (answer === "limit") return { ok: false, reason: dailyLimitReason };
  return {
    ok: true,
    outline: answer ?? {
      language: null,
      notes: null,
      chapters: chaptersFromPdfOutline(pdfOutline),
    },
  };
}

outlineMaterial.maxRetries = RATE_LIMITED_STEP_RETRIES;

/** The first characters of the units that start on each page. */
function pageStarts(units: readonly PageUnit[]) {
  const byPage = Map.groupBy(units, (unit) => unit.pageFrom);
  return [...byPage].map(([page, onPage]) => ({
    page,
    text: onPage
      .map((unit) => unit.markdown)
      .join(" ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, PAGE_START_CHARS),
  }));
}

/** A structure call that failed for good, after the AI SDK's retries. */
class OutlineCallFailed extends Error {}

/**
 * The structure call: its answer, null when it fails for good or gives no
 * valid answer, or "limit" when the Student's Daily limit is reached.
 */
async function callOutline(
  supabase: AdminSupabase,
  studentId: string,
  input: OutlineInput,
): Promise<OutlineAnswer | null | "limit"> {
  const failedCall = (error: unknown) => {
    console.error("The structure call failed:", error);
    return null;
  };
  let result: Awaited<ReturnType<typeof meteredStream>>;
  try {
    result = await meteredStream(
      supabase,
      {
        studentId,
        task: "ingest",
        traceName: "parse-outline",
        callFailed: (error) => {
          throw new OutlineCallFailed(String(error), { cause: error });
        },
      },
      { ...outlineCallSettings(), messages: outlineMessages(input) },
    );
  } catch (error) {
    // Any other failure, such as a rate limit's wait, is the step's.
    if (error instanceof OutlineCallFailed) return failedCall(error.cause);
    throw error;
  }
  if (!result) return "limit";
  try {
    return outlineAnswer(outlineAnswerSchema.parse(await result.output));
  } catch (error) {
    return failedCall(error);
  }
}

/**
 * The chunk step of a parse (`parse-material.ts`): stores the Material's
 * Outline, from `outline` or only the root Chapter, with its chunks, cut
 * from the units of its read pages at every Chapter start
 * (`chunksFromUnits`), in one transaction that replaces any earlier ones,
 * and the language and notes the Outline gave.
 */
export async function chunkMaterial(
  materialId: string,
  outline: OutlineAnswer | null,
): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material || (await hasChunks(supabase, materialId))) return;

  const units = await loadUnits(supabase, materialId);
  const chapters = outlineChapters(
    material.name,
    units,
    outline?.chapters ?? [],
  );
  const chunks = chunksFromUnits(units, chapters);

  if (outline) {
    const named = await supabase
      .from("materials")
      .update({ language: outline.language, notes: outline.notes })
      .eq("id", materialId);
    if (named.error) failed("Storing the language and notes", named.error);
  }
  const replaced = await supabase.rpc("replace_material_chunks", {
    p_material_id: materialId,
    p_chapters: chapters.map((chapter) => ({
      position: chapter.position,
      parent_position: chapter.parentPosition,
      depth: chapter.depth,
      title: chapter.title,
      page_from: chapter.pageFrom,
      exam_proposed: chapter.examProposed,
    })),
    p_chunks: chunks.map((chunk, position) => ({
      position,
      page_from: chunk.pageFrom,
      page_to: chunk.pageTo,
      label: chunk.label,
      markdown: chunk.markdown,
      chapter_position: chunk.chapterPosition,
    })),
  });
  if (replaced.error) failed("Storing the chunks", replaced.error);
}
