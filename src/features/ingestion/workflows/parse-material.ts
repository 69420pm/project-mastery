import { parseFailureReason } from "@/features/ingestion/domain/parse-failure";
import { chunkMaterial } from "@/features/ingestion/workflows/chunk-material";
import { embedChunks } from "@/features/ingestion/workflows/embed-chunks";
import {
  failParse,
  markParsed,
  preparePages,
  readPage,
} from "@/features/ingestion/workflows/parse-steps";

/**
 * Parses one Material into chunks (ADR 0007, 0009): prepares the images of
 * the pages without a stored result, reads each with one vision call, then
 * groups all units into chunks with one file call, embeds the chunks and
 * marks the Material parsed. A retried parse so resumes where it stopped. Steps retry on their
 * own; a step that fails for good, or a reached Daily limit, marks the parse
 * failed with a reason: the file's or the page call's when a step named it,
 * a general one for any other failure. A deleted Material stops it quietly.
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
    if (!outcome.ok) {
      await failParse(materialId, outcome.reason);
      return;
    }
    const embedded = await embedChunks(materialId);
    if (!embedded.ok) {
      await failParse(materialId, embedded.reason);
      return;
    }
    await markParsed(materialId);
  } catch (error) {
    await failParse(materialId, parseFailureReason(error));
  }
}
