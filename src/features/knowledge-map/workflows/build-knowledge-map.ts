import {
  buildFailedReason,
  nothingToMapReason,
} from "@/features/knowledge-map/domain/build-failure";
import {
  assignmentBatches,
  skeletonInput,
} from "@/features/knowledge-map/domain/build-input";
import {
  clustersOf,
  mergeablePairs,
  kcEmbeddingText,
  remainingDuplicates,
  similarPairs,
  withMerges,
} from "@/features/knowledge-map/domain/dedup";
import {
  draftOf,
  kcsOf,
  newKcsOf,
  withDraft,
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
  type Prerequisite,
} from "@/features/knowledge-map/domain/links";
import {
  readingSections,
  sectionsToStore,
} from "@/features/knowledge-map/domain/topic-reading";
import {
  topicsOnMap,
  unplacedKcs,
  withTopicRules,
} from "@/features/knowledge-map/domain/topics";
import {
  newChunks,
  withoutRemoved,
} from "@/features/knowledge-map/domain/update";
import type {
  CheckReport,
  KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import {
  analyseExercise,
  assignBatch,
  decideMerges,
  draftSkeleton,
  embedKcs,
  failBuild,
  fillBigIdea,
  findScopeRemarks,
  linkNewKcs,
  loadBuildInput,
  storeMap,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  loadReadingInput,
  storeReadingSections,
} from "@/features/knowledge-map/workflows/reading-steps";
import {
  groupTopics,
  loadTopicsInput,
  storeTopics,
} from "@/features/knowledge-map/workflows/topic-steps";

/**
 * Updates a Course's Knowledge map with the chunks of its parsed Materials
 * that no update has processed yet (#69, #83); a first build updates an
 * empty map. It first drops what deleted chunks taught: taught KCs and
 * Findings with no source chunk left, and prior KCs no remaining KC needs.
 * Then, one step per model call and on the new chunks only: (1) the skeleton
 * adds big ideas and candidate KCs to the map's, (2) assignment of chunks to
 * the map's KCs and the candidates in batches, which may add KCs, after
 * which candidates no chunk teaches are dropped, (3) a fill per big idea
 * with each new KC's type and Bloom level, and (4) one links call for the
 * new KCs' prerequisites, semantic links and prior knowledge, after which
 * code breaks prerequisite cycles and drops redundant prerequisites over the
 * whole map. (5) One `exercise` call per new exercise subtask maps it to KCs
 * and checks or generates its solution (#70). A KC more than one subtask
 * proposes joins the map from those exercises, and one more links call
 * links the KCs so added. Code sets each Exercise's difficulty and records a
 * disputed solution as a Finding. With new `admin` chunks, one scope call
 * finds their remarks that exclude or limit exam content, each a `scope`
 * Finding for the Student (#85). (6) Dedup embeds the KCs when some are
 * new, and merges the duplicates one call finds among the new KCs' close
 * pairs (`withoutDuplicates`). (7) Code checks the whole map, which is
 * stored with its check report, keeping the ids of its stored rows, and the
 * new chunks are recorded as processed. (2b) The Topics stage then groups
 * the stored map's unplaced KCs into Topics (`buildTopics`). (2c) The Reading
 * stage then cuts each Topic's Reading sections (`buildReading`), and
 * storing them marks the build built. With nothing new and every KC placed,
 * the update makes no model call. A step that fails for good, or a reached
 * Daily limit, fails the build with a reason: before the map is stored, it
 * leaves the stored map and its chunks new; in the Topics stage, the map
 * stays stored and the next update runs the Topics stage again. A deleted
 * Course stops it quietly.
 */
export async function buildKnowledgeMap(courseId: string): Promise<void> {
  "use workflow";
  try {
    const input = await loadBuildInput(courseId);
    if (!input) return;
    const { studentId, chunks } = input;
    const fresh = newChunks(chunks, input.processedChunkIds);
    const batches = assignmentBatches(fresh);
    if (batches.length === 0 && input.map.kcs.length === 0) {
      await failBuild(courseId, nothingToMapReason);
      return;
    }

    let map = withoutRemoved(input.map);
    const existing = new Set(map.kcs.map((kc) => kc.id));
    let draft = draftOf(map);
    if (batches.length > 0) {
      const skeleton = await draftSkeleton(
        studentId,
        skeletonInput(fresh, draft),
        draft,
      );
      if (!skeleton.ok) {
        await failBuild(courseId, skeleton.reason);
        return;
      }
      draft = skeleton.value;
      for (const batch of batches) {
        const assigned = await assignBatch(studentId, draft, batch);
        if (!assigned.ok) {
          await failBuild(courseId, assigned.reason);
          return;
        }
        draft = assigned.value;
      }
      draft = withoutUnsourced(draft);
    }

    const markdown = new Map(chunks.map((chunk) => [chunk.id, chunk.markdown]));
    const added = new Set(newKcsOf(map, draft).map((kc) => kc.id));
    const fills: Record<string, KcFill> = {};
    for (const bigIdea of draft.bigIdeas) {
      const kcs = kcsOf(draft, bigIdea.id)
        .filter((kc) => added.has(kc.id))
        .map((kc) => ({
          ...kc,
          chunks: kc.sources.map((id) => markdown.get(id) ?? ""),
        }));
      if (kcs.length === 0) continue;
      const filled = await fillBigIdea(studentId, bigIdea, kcs);
      if (!filled.ok) {
        await failBuild(courseId, filled.reason);
        return;
      }
      Object.assign(fills, filled.value);
    }

    map = withDraft(map, draft, fills);
    let droppedCycleEdges: Prerequisite[] = [];
    if (added.size > 0) {
      const links = await linkNewKcs(studentId, map, [...added]);
      if (!links.ok) {
        await failBuild(courseId, links.reason);
        return;
      }
      ({ map, droppedCycleEdges } = withAddedKcLinks(
        map,
        [...added],
        links.value,
      ));
    }

    const taskTypes = [
      ...new Set(map.exercises.map((exercise) => exercise.taskType)),
    ];
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
      const links = await linkNewKcs(studentId, map, merged.addedKcIds);
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

    const adminChunks = fresh.filter((chunk) => chunk.label === "admin");
    if (adminChunks.length > 0) {
      const scope = await findScopeRemarks(studentId, adminChunks);
      if (!scope.ok) {
        await failBuild(courseId, scope.reason);
        return;
      }
      map = { ...map, findings: [...map.findings, ...scope.value] };
    }

    const deduped = await withoutDuplicates(studentId, map, existing);
    if (!deduped.ok) {
      await failBuild(courseId, deduped.reason);
      return;
    }
    map = deduped.value.map;
    await storeMap(
      courseId,
      map,
      fresh.map((chunk) => chunk.id),
      checkMap(
        map,
        chunks,
        [...droppedCycleEdges, ...deduped.value.droppedCycleEdges],
        deduped.value.duplicates,
      ),
    );
    const topics = await buildTopics(courseId);
    if (!topics.ok) {
      await failBuild(courseId, topics.reason);
      return;
    }
    await buildReading(courseId);
  } catch (error) {
    console.error("Building the knowledge map failed:", error);
    await failBuild(courseId, buildFailedReason);
  }
}

/**
 * Stage 2b, Topics (#175), on the stored map: one `topic` call per Big idea
 * with a non-prior KC no Topic holds, after removed and moved KCs left their
 * Topics, so an unchanged Big idea costs nothing. Code then merges small
 * Topics and orders KCs and Topics over all Big ideas, and stores them.
 */
async function buildTopics(courseId: string): Promise<StepOutcome<null>> {
  const input = await loadTopicsInput(courseId);
  if (!input) return { ok: true, value: null };
  const { studentId, ...rest } = input;
  let topics = topicsOnMap(input.map, input.topics);
  for (const [bigIdea, newKcIds] of unplacedKcs(input.map, topics)) {
    const grouped = await groupTopics(
      studentId,
      { ...rest, topics },
      bigIdea,
      newKcIds,
    );
    if (!grouped.ok) return grouped;
    topics = grouped.value;
  }
  await storeTopics(
    courseId,
    withTopicRules(
      input.map,
      topics,
      input.chunks.map((chunk) => chunk.id),
    ),
  );
  return { ok: true, value: null };
}

/**
 * Stage 2c, Reading (#178), on the stored Topics: cuts each Topic's Reading
 * sections from the chunks its KCs cite, keeps the stored sections with the
 * same chunks and stores the rest as new `original` sections, which marks
 * the build built. Makes no model call yet.
 */
async function buildReading(courseId: string): Promise<void> {
  const input = await loadReadingInput(courseId);
  if (!input) return;
  await storeReadingSections(
    courseId,
    sectionsToStore(
      input.topics.map((topic) => ({
        topicId: topic.id,
        sections: readingSections(
          topic.kcs.flatMap((id) => input.kcSources[id] ?? []),
          input.spans,
        ),
      })),
      input.stored,
    ),
  );
}

/**
 * Step 6, dedup: embeds every KC when the map has new ones, and when new
 * KCs come close to others one call decides which are one KC, which code
 * merges. Returns the merged map, the cycle edges the merges dropped and
 * the pairs that stay above the threshold. No model call without new KCs.
 */
async function withoutDuplicates(
  studentId: string,
  map: KnowledgeMap,
  existing: ReadonlySet<string>,
): Promise<
  StepOutcome<{
    map: KnowledgeMap;
    droppedCycleEdges: Prerequisite[];
    duplicates: CheckReport["duplicates"];
  }>
> {
  const newIds = new Set(
    map.kcs.filter((kc) => !existing.has(kc.id)).map((kc) => kc.id),
  );
  if (newIds.size === 0) {
    return { ok: true, value: { map, droppedCycleEdges: [], duplicates: [] } };
  }
  const vectors = await embedKcs(studentId, map.kcs.map(kcEmbeddingText));
  if (!vectors.ok) return vectors;
  const pairs = similarPairs(map.kcs, vectors.value, newIds);
  const clusters = clustersOf(
    mergeablePairs(pairs, map.kcs),
    map.kcs.map((kc) => kc.id),
  );
  let merged: ReturnType<typeof withMerges> = {
    map,
    merges: [],
    droppedCycleEdges: [],
  };
  if (clusters.length > 0) {
    const groups = await decideMerges(studentId, map, clusters);
    if (!groups.ok) return groups;
    merged = withMerges(map, groups.value, existing);
  }
  for (const merge of merged.merges) {
    console.info(`Merged KCs into "${merge.kept}": ${merge.merged.join("; ")}`);
  }
  return {
    ok: true,
    value: {
      map: merged.map,
      droppedCycleEdges: merged.droppedCycleEdges,
      duplicates: remainingDuplicates(merged.map, pairs),
    },
  };
}
