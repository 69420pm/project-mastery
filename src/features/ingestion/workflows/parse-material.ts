import type { OutlineAnswer } from "@/features/ingestion/ai/outline";
import { parseFailureReason } from "@/features/ingestion/domain/parse-failure";
import {
  chunkMaterial,
  outlineMaterial,
} from "@/features/ingestion/workflows/chunk-material";
import { embedChunks } from "@/features/ingestion/workflows/embed-chunks";
import { pairMaterialCourse } from "@/features/ingestion/workflows/pair-exercises";
import {
  failParse,
  markParsed,
  PAGES_PER_STEP,
  preparePages,
  readPages,
} from "@/features/ingestion/workflows/parse-steps";

/**
 * Parses one Material into an Outline and chunks (ADR 0007, 0009): prepares
 * its pages and skips slide overlays, reads the pages without a stored
 * result in steps of up to PAGES_PER_STEP, one vision call per batch of
 * pages, then finds the Material's Outline in one structure call, cuts the
 * units into chunks at its Chapters, embeds them, pairs the Course's
 * exercises with their solutions and marks the Material parsed. A page that
 * cannot be read is stored unreadable and the parse goes on; a retried
 * parse resumes at the first page without a result. Steps retry on their
 * own; a step that fails for good, or a reached Daily limit, marks the
 * parse failed with a reason: the file's when a step named it, a general
 * one for any other failure. A deleted Material stops it quietly.
 *
 * For the smoke checks: `options.pages` reads only those pages, and
 * `options.outline` is used instead of the structure call. Returns the
 * Outline the chunks were cut by, null when none was found now.
 */
export async function parseMaterial(
  materialId: string,
  options: { pages?: number[]; outline?: OutlineAnswer } = {},
): Promise<OutlineAnswer | null> {
  "use workflow";
  try {
    let pages = await preparePages(materialId, options.pages);
    while (pages && pages.length > 0) {
      const outcome = await readPages(
        materialId,
        pages.slice(0, PAGES_PER_STEP),
      );
      if (!outcome.ok) {
        await failParse(materialId, outcome.reason);
        return null;
      }
      pages = outcome.left && [...outcome.left, ...pages.slice(PAGES_PER_STEP)];
    }
    if (!pages) return null;
    const outlined = await outlineMaterial(materialId, options.outline);
    if (!outlined.ok) {
      await failParse(materialId, outlined.reason);
      return null;
    }
    await chunkMaterial(materialId, outlined.outline);
    const embedded = await embedChunks(materialId);
    if (!embedded.ok) {
      await failParse(materialId, embedded.reason);
      return null;
    }
    const paired = await pairMaterialCourse(materialId);
    if (!paired.ok) {
      await failParse(materialId, paired.reason);
      return null;
    }
    await markParsed(materialId);
    return outlined.outline;
  } catch (error) {
    console.error("Parsing the Material failed:", error);
    await failParse(materialId, parseFailureReason(error));
    return null;
  }
}
