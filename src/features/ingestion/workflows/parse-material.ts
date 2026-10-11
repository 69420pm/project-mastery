import { chunkMaterial } from "@/features/ingestion/workflows/chunk-material";
import {
  fileUnreadableReason,
  pageUnreadableReason,
  parseFailedReason,
} from "@/features/ingestion/domain/parse-failure";
import {
  failParse,
  preparePages,
  readPage,
} from "@/features/ingestion/workflows/parse-steps";

/** A step's result, or `failed` when it failed for good. */
async function orFailed<T>(step: Promise<T>): Promise<T | typeof failed> {
  try {
    return await step;
  } catch {
    return failed;
  }
}
const failed = Symbol("failed");

/**
 * Parses one Material into chunks (ADR 0007, 0009): prepares the images of
 * the pages without a stored result, reads each with one vision call, then
 * groups all units into chunks with one file call and marks the Material
 * parsed. A retried parse so resumes where it stopped. Steps retry on their
 * own; a step that fails for good, or a reached Daily limit, marks the parse
 * failed with a reason. A deleted Material stops it quietly.
 */
export async function parseMaterial(materialId: string): Promise<void> {
  "use workflow";
  try {
    const pages = await orFailed(preparePages(materialId));
    if (pages === failed) {
      await failParse(materialId, fileUnreadableReason);
      return;
    }
    if (!pages) return;
    for (const page of pages) {
      const outcome = await orFailed(readPage(materialId, page));
      if (outcome === failed) {
        await failParse(materialId, pageUnreadableReason(page.pageNumber));
        return;
      }
      if (!outcome.ok) {
        await failParse(materialId, outcome.reason);
        return;
      }
    }
    const outcome = await chunkMaterial(materialId);
    if (!outcome.ok) await failParse(materialId, outcome.reason);
  } catch {
    await failParse(materialId, parseFailedReason);
  }
}
