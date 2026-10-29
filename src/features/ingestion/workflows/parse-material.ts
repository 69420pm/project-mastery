import { parseFailureReason } from "@/features/ingestion/domain/parse-failure";
import { chunkMaterial } from "@/features/ingestion/workflows/chunk-material";
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
 * Parses one Material into chunks (ADR 0007, 0009): prepares its pages and
 * skips slide overlays, reads the pages without a stored result in steps of
 * up to PAGES_PER_STEP, one vision call per page, then turns the units into
 * chunks, embeds them, pairs the Course's exercises with their solutions and
 * marks the Material parsed. A page whose call fails is stored unreadable
 * and the parse goes on; a retried parse resumes at the first page without a
 * result. Steps retry on their own; a step that fails for good, or a reached
 * Daily limit, marks the parse failed with a reason: the file's when a step
 * named it, a general one for any other failure. A deleted Material stops
 * it quietly. `options.pages` reads only those pages (the parse smoke
 * check).
 */
export async function parseMaterial(
  materialId: string,
  options: { pages?: number[] } = {},
): Promise<void> {
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
        return;
      }
      pages = outcome.left && [...outcome.left, ...pages.slice(PAGES_PER_STEP)];
    }
    if (!pages) return;
    await chunkMaterial(materialId);
    const embedded = await embedChunks(materialId);
    if (!embedded.ok) {
      await failParse(materialId, embedded.reason);
      return;
    }
    const paired = await pairMaterialCourse(materialId);
    if (!paired.ok) {
      await failParse(materialId, paired.reason);
      return;
    }
    await markParsed(materialId);
  } catch (error) {
    await failParse(materialId, parseFailureReason(error));
  }
}
