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
  exerciseFromAnswer,
  withExerciseKcs,
  type ExerciseAnswer,
} from "@/features/knowledge-map/domain/exercises";
import {
  checkMap,
  withAddedKcLinks,
  withLinks,
  type Prerequisite,
} from "@/features/knowledge-map/domain/links";
import {
  analyseExercise,
  assignBatch,
  draftSkeleton,
  failBuild,
  fillBigIdea,
  linkAddedKcs,
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
 * for prerequisites, semantic links and prior knowledge, after which code
 * breaks prerequisite cycles and drops redundant prerequisites. (5) One
 * `exercise` call per exercise subtask maps it to KCs and checks or
 * generates its solution (#70). A KC more than one subtask proposes joins
 * the map from those exercises, and (6) one more links call links the KCs
 * so added, after which code breaks cycles and drops redundant
 * prerequisites again. Code sets each Exercise's difficulty and records a
 * disputed solution as a Finding. (7) Code checks the map, and the map with
 * its Exercises, Findings and check report replaces the Course's previous
 * one. A step that fails for good, or a reached Daily limit, fails the build
 * with a reason and leaves the previous map. A deleted Course stops it
 * quietly.
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

    const taskTypes: string[] = [];
    const answers: ExerciseAnswer[] = [];
    for (const exercise of input.exercises) {
      const answer = await analyseExercise(studentId, exercise, map, taskTypes);
      if (!answer.ok) {
        await failBuild(courseId, answer.reason);
        return;
      }
      answers.push(answer.value);
      const taskType = answer.value.taskType.trim();
      if (!taskTypes.includes(taskType)) taskTypes.push(taskType);
    }

    const merged = withExerciseKcs(
      map,
      input.exercises.map((exercise, index) => ({
        questionChunkId: exercise.questionChunkId,
        newKcs: answers[index]?.newKcs ?? [],
      })),
    );
    map = merged.map;
    if (merged.addedKcIds.length > 0) {
      const links = await linkAddedKcs(studentId, map, merged.addedKcIds);
      if (!links.ok) {
        await failBuild(courseId, links.reason);
        return;
      }
      const relinked = withAddedKcLinks(map, merged.addedKcIds, links.value);
      map = relinked.map;
      droppedCycleEdges = [...droppedCycleEdges, ...relinked.droppedCycleEdges];
    }

    input.exercises.forEach((exercise, index) => {
      const answer = answers[index];
      if (!answer) return;
      const { exercise: analysed, finding } = exerciseFromAnswer(
        exercise,
        {
          ...answer,
          kcIds: [...answer.kcIds, ...(merged.kcIds[index] ?? [])],
        },
        map,
      );
      map = {
        ...map,
        exercises: [...map.exercises, analysed],
        findings: finding ? [...map.findings, finding] : map.findings,
      };
    });

    await storeMap(courseId, map, checkMap(map, chunks, droppedCycleEdges));
  } catch (error) {
    console.error("Building the knowledge map failed:", error);
    await failBuild(courseId, buildFailedReason);
  }
}
