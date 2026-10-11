import "server-only";
import { start } from "workflow/api";
import { parseMaterial } from "@/features/ingestion/workflows/parse-material";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Starts the parse workflow of one of the signed-in Student's `queued`
 * Materials. When it cannot start, the Material stays `queued`, marked as
 * not started so the page offers Parse, and the error is logged, not
 * thrown: the upload itself has succeeded.
 */
export async function startParse(
  supabase: Supabase,
  materialId: string,
): Promise<void> {
  try {
    await start(parseMaterial, [materialId]);
  } catch (error) {
    console.error("Starting the parse of a Material failed:", error);
    const { error: recordError } = await supabase.rpc(
      "record_parse_start_failure",
      { material_id: materialId },
    );
    if (recordError) {
      console.error("Recording a failed parse start failed:", recordError);
    }
  }
}
