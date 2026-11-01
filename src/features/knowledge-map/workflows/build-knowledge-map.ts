import { buildFailedReason } from "@/features/knowledge-map/domain/build-failure";
import {
  failBuild,
  markBuilt,
} from "@/features/knowledge-map/workflows/build-steps";

/**
 * Updates a Course's Knowledge map. The build from Parts is gone with the
 * Parts (#228); until it works from Chapters (#229), the build only marks
 * the map built, without model calls. A failed step fails the build with a
 * reason.
 */
export async function buildKnowledgeMap(courseId: string): Promise<void> {
  "use workflow";
  try {
    await markBuilt(courseId);
  } catch (error) {
    console.error("Building the knowledge map failed:", error);
    await failBuild(courseId, buildFailedReason);
  }
}
