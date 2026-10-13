import "server-only";
import { start } from "workflow/api";
import { buildKnowledgeMap } from "@/features/knowledge-map/workflows/build-knowledge-map";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Starts the build workflow of the signed-in Student's Course, which
 * `queue_knowledge_map_build` has just moved to `building`. When it cannot
 * start, the build is failed with a reason, so the page offers Build again,
 * and the error is logged, not thrown.
 */
export async function startBuild(
  supabase: Supabase,
  courseId: string,
): Promise<void> {
  try {
    await start(buildKnowledgeMap, [courseId]);
  } catch (error) {
    console.error("Starting the knowledge map build failed:", error);
    const { error: recordError } = await supabase.rpc(
      "record_knowledge_map_build_start_failure",
      { course_id: courseId },
    );
    if (recordError) {
      console.error("Recording a failed build start failed:", recordError);
    }
  }
}
