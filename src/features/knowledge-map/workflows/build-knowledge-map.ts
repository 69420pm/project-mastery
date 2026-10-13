import {
  buildFailedReason,
  nothingToMapReason,
} from "@/features/knowledge-map/domain/build-failure";
import {
  assignmentBatches,
  skeletonInput,
} from "@/features/knowledge-map/domain/build-input";
import {
  completeMap,
  kcsOf,
  withoutUnsourced,
  type KcFill,
} from "@/features/knowledge-map/domain/draft";
import {
  checkMap,
  withLinks,
  type Prerequisite,
} from "@/features/knowledge-map/domain/links";
import {
  assignBatch,
  draftSkeleton,
  failBuild,
  fillBigIdea,
  linkKcs,
  loadBuildInput,
  storeMap,
} from "@/features/knowledge-map/workflows/build-steps";

/**
 * Builds a Course's Knowledge map from the chunks of its parsed Materials
 * (#69), one step per model call: (1) the skeleton of big ideas and
 * candidate KCs, (2) assignment of chunks to KCs in batches, which may add
 * KCs, after which candidates no chunk teaches are dropped, and (3) a fill
 * per big idea with each KC's type and Bloom level, and (4) one links call
 * for prerequisites, semantic links and prior knowledge. (5) Code then breaks
 * prerequisite cycles, drops redundant prerequisites and checks the map, and
 * the map with its check report replaces the Course's previous one. A step that fails for good, or a reached Daily
 * limit, fails the build with a reason and leaves the previous map. A
 * deleted Course stops it quietly.
 */
export async function buildKnowledgeMap(courseId: string): Promise<void> {
  "use workflow";
  try {
    const input = await loadBuildInput(courseId);
    if (!input) return;
    const { studentId, chunks } = input;
    const batches = assignmentBatches(chunks);
    if (batches.length === 0) {
      await failBuild(courseId, nothingToMapReason);
      return;
    }

    const skeleton = await draftSkeleton(studentId, skeletonInput(chunks));
    if (!skeleton.ok) {
      await failBuild(courseId, skeleton.reason);
      return;
    }
    let draft = skeleton.value;
    for (const batch of batches) {
      const assigned = await assignBatch(studentId, draft, batch);
      if (!assigned.ok) {
        await failBuild(courseId, assigned.reason);
        return;
      }
      draft = assigned.value;
    }
    draft = withoutUnsourced(draft);

    const markdown = new Map(chunks.map((chunk) => [chunk.id, chunk.markdown]));
    const fills: Record<string, KcFill> = {};
    for (const bigIdea of draft.bigIdeas) {
      const kcs = kcsOf(draft, bigIdea.id).map((kc) => ({
        ...kc,
        chunks: kc.sources.map((id) => markdown.get(id) ?? ""),
      }));
      const filled = await fillBigIdea(studentId, bigIdea, kcs);
      if (!filled.ok) {
        await failBuild(courseId, filled.reason);
        return;
      }
      Object.assign(fills, filled.value);
    }

    let map = completeMap(draft, fills);
    let droppedCycleEdges: Prerequisite[] = [];
    if (map.kcs.length > 0) {
      const links = await linkKcs(studentId, map);
      if (!links.ok) {
        await failBuild(courseId, links.reason);
        return;
      }
      ({ map, droppedCycleEdges } = withLinks(map, links.value));
    }

    await storeMap(courseId, map, checkMap(map, chunks, droppedCycleEdges));
  } catch (error) {
    console.error("Building the knowledge map failed:", error);
    await failBuild(courseId, buildFailedReason);
  }
}
