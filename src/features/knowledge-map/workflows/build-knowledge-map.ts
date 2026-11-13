import { sleep } from "workflow";
import {
  buildFailedReason,
  nothingToMapReason,
} from "@/features/knowledge-map/domain/build-failure";
import { arrangeKnowledgeMap } from "@/features/knowledge-map/workflows/arrange-steps";
import {
  failBuild,
  prepareBuild,
  type BuildStep,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { consolidateKcs } from "@/features/knowledge-map/workflows/consolidate-steps";
import { extractExercises } from "@/features/knowledge-map/workflows/exercise-steps";
import { extractChapters } from "@/features/knowledge-map/workflows/extract-steps";
import {
  matchAssumptions,
  rematchAssumptions,
} from "@/features/knowledge-map/workflows/prerequisite-steps";
import { proposeTopicTree } from "@/features/knowledge-map/workflows/topic-steps";

/**
 * Updates a Course's Knowledge map from its Chapters (#229). The workflow
 * passes only the Course's id; each step reads and writes tables and stores
 * its results before it ends. It retires KCs whose sources are gone,
 * extracts the teaching units without a current extraction, stores their
 * KCs merged with alike ones, then extracts and stores the exercise units'
 * Exercises the same way. It matches what the KCs assume to earlier KCs as
 * Prerequisites, or keeps it on the KC as text, matching such text again
 * when the build stored KCs near it. It groups the Chapters
 * into a Topic tree (one call, only when the Outlines or KCs changed) and
 * puts the map in Course order. A unit whose call fails (a timeout, or no
 * valid answer) is left to the next step. An extraction unit is then split
 * into pieces until it is given up, and the check report lists it. A match
 * call is asked again in halved calls, and after four failed tries its
 * names stay as text. A merge call that fails twice fails the build with a
 * reason naming its Chapter. A call the Gateway's rate limit turns away is
 * no failure: its step stores what was answered, and the workflow sleeps
 * the wait it named before the next step calls the rest. A step that fails
 * for good, or a reached Daily limit, fails the build with a reason and
 * loses only that step's calls: the next Update map resumes where the
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
    // Names matched again pick up after the last one an earlier run handled.
    let after = "";
    const rematch: BuildStep = async () => {
      const outcome = await rematchAssumptions(courseId, after);
      if (outcome.ok) after = outcome.after;
      return outcome;
    };
    // Exercises are matched to the KCs the teaching units gave, and their
    // new KCs are consolidated like those. Stored names are matched again
    // before the new ones are matched, which already see this build's KCs.
    const steps: BuildStep[] = [
      extractChapters,
      consolidateKcs,
      extractExercises,
      consolidateKcs,
      rematch,
      matchAssumptions,
    ];
    for (const step of steps) {
      // The units whose call failed in earlier runs of this step, a key
      // once per failure.
      let failed: string[] = [];
      for (;;) {
        const outcome: StepOutcome = await step(courseId, failed);
        if (!outcome.ok) {
          await failBuild(courseId, outcome.reason);
          return;
        }
        if (outcome.left === null) return;
        if (outcome.left === 0) break;
        failed = [...failed, ...(outcome.failed ?? [])];
        // The rate limit turned a call away: its units wait, nothing failed.
        if (outcome.waitMs !== undefined) await sleep(outcome.waitMs);
      }
    }
    const proposal = await proposeTopicTree(courseId);
    if (!proposal.ok) {
      await failBuild(courseId, proposal.reason);
      return;
    }
    if (proposal.tree === null) return;
    await arrangeKnowledgeMap(courseId, proposal.tree);
  } catch (error) {
    console.error("Building the knowledge map failed:", error);
    await failBuild(courseId, buildFailedReason);
  }
}
