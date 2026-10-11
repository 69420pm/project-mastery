import "server-only";
import { start } from "workflow/api";
import { parseMaterial } from "@/features/ingestion/workflows/parse-material";

/**
 * Starts the parse workflow of a `queued` Material. When it cannot start, the
 * Material stays `queued` and the error is logged, not thrown: the upload
 * itself has succeeded.
 */
export async function startParse(materialId: string): Promise<void> {
  try {
    await start(parseMaterial, [materialId]);
  } catch (error) {
    console.error("Starting the parse of a Material failed:", error);
  }
}
