import {
  buildFailedReason,
  nothingToMapReason,
} from "@/features/knowledge-map/domain/build-failure";
import {
  arrangeKnowledgeMap,
  failBuild,
  prepareBuild,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { consolidateKcs } from "@/features/knowledge-map/workflows/consolidate-steps";
import { extractExercises } from "@/features/knowledge-map/workflows/exercise-steps";
import { extractParts } from "@/features/knowledge-map/workflows/extract-steps";

/**
 * Updates a Course's Knowledge map from its Parts (#225). The workflow
 * passes only the Course's id; each step reads and writes tables and stores
 * its results before it ends. It retires KCs whose sources are gone,
 * extracts the teaching Parts without a current extraction, stores their
 * KCs merged with alike ones, then extracts and stores the exercise Parts'
 * Exercises the same way, and puts the map in Course order. A step that
 * fails for good, or a reached Daily limit, fails the build with a reason
 * and loses only that step's calls: the next Update map resumes where the
 * build stopped.
 */
export async function buildKnowledgeMap(courseId: string): Promise<void> {
  "use workflow";
  try {
    const prepared = await prepareBuild(courseId);
    if (prepared === "stopped") return;
    if (prepared === "nothing") {
      await failBuild(courseId, nothingToMapReason);
      return;
    }
    // Exercises are matched to the KCs the teaching Parts gave, and their
    // new KCs are consolidated like those.
    for (const step of [
      extractParts,
      consolidateKcs,
      extractExercises,
      consolidateKcs,
    ]) {
      for (;;) {
        const outcome: StepOutcome = await step(courseId);
        if (!outcome.ok) {
          await failBuild(courseId, outcome.reason);
          return;
        }
        if (outcome.left === null) return;
        if (outcome.left === 0) break;
      }
    }
    await arrangeKnowledgeMap(courseId);
  } catch (error) {
    console.error("Building the knowledge map failed:", error);
    await failBuild(courseId, buildFailedReason);
  }
}
