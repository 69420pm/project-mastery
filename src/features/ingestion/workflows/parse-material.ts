import { chunkMaterial } from "@/features/ingestion/workflows/chunk-material";
import {
  failParse,
  preparePages,
  readPage,
} from "@/features/ingestion/workflows/parse-steps";

/** What the Student sees when a step failed for good. */
const failedReason = "The material could not be parsed. Please try again.";

/**
 * Parses one Material into chunks (ADR 0007, 0009): prepares its page
 * images, reads each page with one vision call, then groups all units into
 * chunks with one file call and marks the Material parsed. Steps retry on
 * their own; a step that fails for good, or a reached Daily limit, marks the
 * parse failed.
 */
export async function parseMaterial(materialId: string): Promise<void> {
  "use workflow";
  try {
    const pages = await preparePages(materialId);
    if (!pages) return;
    for (const page of pages) {
      const outcome = await readPage(materialId, page);
      if (!outcome.ok) {
        await failParse(materialId, outcome.reason);
        return;
      }
    }
    const outcome = await chunkMaterial(materialId);
    if (!outcome.ok) await failParse(materialId, outcome.reason);
  } catch {
    await failParse(materialId, failedReason);
  }
}
