import { buildFailedReason } from "@/features/knowledge-map/domain/build-failure";
import {
  failBuild,
  markBuilt,
} from "@/features/knowledge-map/workflows/build-steps";

/**
 * Updates a Course's Knowledge map. The build from Parts (#225) replaces the
 * old stages; until it lands, an update only marks the build built and
 * leaves the stored map as it is. A step that fails for good fails the
 * build with a reason.
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
