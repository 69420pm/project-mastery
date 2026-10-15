import "server-only";
import { embedMany, generateText } from "ai";
import {
  loadCourseChunks,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import {
  exerciseAnswerSchema,
  exerciseCall,
  givenSolutionSchema,
} from "@/features/knowledge-map/ai/exercise-calls";
import {
  addedKcLinksCall,
  assignmentCall,
  assignmentSchema,
  fillCall,
  fillSchema,
  linksCall,
  linksSchema,
  mergeCall,
  mergeSchema,
  scopeCall,
  scopeSchema,
  skeletonCall,
  skeletonSchema,
} from "@/features/knowledge-map/ai/map-calls";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  exerciseInputs,
  type ExerciseInput,
  type SkeletonInput,
} from "@/features/knowledge-map/domain/build-input";
import {
  applyAssignment,
  draftFromSkeleton,
  type Draft,
  type DraftBigIdea,
  type DraftKc,
  type KcFill,
} from "@/features/knowledge-map/domain/draft";
import type { ExerciseAnswer } from "@/features/knowledge-map/domain/exercises";
import type { LinksProposal } from "@/features/knowledge-map/domain/links";
import { aliases } from "@/features/knowledge-map/domain/update";
import {
  knowledgeMapSchema,
  type CheckReport,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import {
  loadProcessedChunkIds,
  loadStoredMap,
} from "@/features/knowledge-map/server/stored-map";
import type { MapChunk } from "@/features/knowledge-map/types";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { estimatedUsage, tokenUsage } from "@/lib/ai/cost";
import { isDailyQuotaError } from "@/lib/ai/daily-quota";
import { aiTask, answeringModel, type AiTask } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * The steps of a Knowledge map update (`build-knowledge-map.ts`). Each runs on
 * the admin client, since no Student is signed in, and so scopes every query
 * to the Course and its owner itself. Model calls get their input from the
 * workflow, so a Material parsed during a build joins the next one.
 */

/** A step's result, or why the build stops, for the Student. */
export type StepOutcome<T> =
  { ok: true; value: T } | { ok: false; reason: string };

function fail(action: string, error: { message: string }): never {
  throw new Error(`${action} failed: ${error.message}`);
}

/**
 * What an update reads once: whose Course it is, its chunks, the ones an
 * earlier update processed, the exercise subtasks of the new chunks with
 * their paired solutions, and the stored map.
 */
export type BuildInput = {
  studentId: string;
  chunks: MapChunk[];
  processedChunkIds: string[];
  exercises: ExerciseInput[];
  map: KnowledgeMap;
};

/**
 * The owner, chunks, new exercise subtasks and stored map of the Course
 * whose build runs. Null when no build runs any more, as when the Course was
 * deleted.
 */
export async function loadBuildInput(
  courseId: string,
): Promise<BuildInput | null> {
  "use step";
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("knowledge_map_builds")
    .select("owner")
    .eq("course_id", courseId)
    .eq("status", "building")
    .maybeSingle();
  if (error) fail("Loading the build", error);
  if (!data) return null;
  const [chunks, pairs, processedChunkIds, map] = await Promise.all([
    loadCourseChunks(supabase, courseId),
    loadExerciseSolutions(supabase, courseId),
    loadProcessedChunkIds(supabase, courseId),
    loadStoredMap(supabase, courseId),
  ]);
  const processed = new Set(processedChunkIds);
  return {
    studentId: data.owner,
    chunks: chunks.map(({ id, materialName, pageFrom, label, markdown }) => ({
      id,
      materialName,
      pageFrom,
      label,
      markdown,
    })),
    processedChunkIds,
    exercises: exerciseInputs(chunks, pairs).filter(
      (exercise) => !processed.has(exercise.questionChunkId),
    ),
    map,
  };
}

/**
 * One model call for the Student, after checking their Daily limit, with
 * its usage recorded. Null when the Daily limit or the provider's daily
 * quota is used up.
 */
async function mapCall(
  studentId: string,
  traceName: string,
  call: Parameters<typeof generateText>[0] & {
    model: string;
    providerOptions?: { gateway?: { models?: readonly string[] } };
  },
  task: AiTask = "map",
): Promise<unknown> {
  const supabase = createAdminClient();
  const dailyLimit = await checkDailyLimit(supabase, { studentId });
  if (dailyLimit.level === "reached") return null;

  const result = await withTraceAttributes(
    { userId: studentId, traceName },
    () => generateText(call),
  ).catch((error: unknown) => {
    if (isDailyQuotaError(error)) return null;
    throw error;
  });
  if (!result) return null;
  await recordAiUsage(
    supabase,
    {
      task,
      modelId: answeringModel(call, result.response.modelId),
      usage: tokenUsage(result.usage),
    },
    { studentId },
  );
  return result.output;
}

const limitReached = { ok: false, reason: dailyLimitReason } as const;

/**
 * Step 1: new big ideas and candidate KCs from the outline of the new
 * chunks, added to the `base` draft of the stored map.
 */
export async function draftSkeleton(
  studentId: string,
  input: SkeletonInput,
  base: Draft,
): Promise<StepOutcome<Draft>> {
  "use step";
  const output = await mapCall(studentId, "map-skeleton", skeletonCall(input));
  if (output === null) return limitReached;
  return {
    ok: true,
    value: draftFromSkeleton(skeletonSchema.parse(output), base),
  };
}

/**
 * Step 2, one batch: which KCs each chunk teaches, and new KCs the chunks
 * teach. Chunks, KCs and big ideas go to the model by short local ids.
 */
export async function assignBatch(
  studentId: string,
  draft: Draft,
  batch: MapChunk[],
): Promise<StepOutcome<Draft>> {
  "use step";
  const chunkIds = aliases(
    batch.map((chunk) => chunk.id),
    "c",
  );
  const kcIds = aliases(
    draft.kcs.map((kc) => kc.id),
    "k",
  );
  const bigIdeaIds = aliases(
    draft.bigIdeas.map((bigIdea) => bigIdea.id),
    "b",
  );
  const bigIdeas = draft.bigIdeas.map((bigIdea) => ({
    ...bigIdea,
    id: bigIdeaIds.local(bigIdea.id),
  }));
  const kcs = draft.kcs.map((kc) => ({
    ...kc,
    id: kcIds.local(kc.id),
    bigIdea: bigIdeaIds.local(kc.bigIdea),
  }));
  const chunks = batch.map((chunk) => ({
    id: chunkIds.local(chunk.id),
    label: chunk.label,
    markdown: chunk.markdown,
  }));
  const output = await mapCall(
    studentId,
    "map-assignment",
    assignmentCall(bigIdeas, kcs, chunks),
  );
  if (output === null) return limitReached;
  const parsed = assignmentSchema(
    chunks.map((chunk) => chunk.id),
    kcs.map((kc) => kc.id),
    bigIdeas.map((bigIdea) => bigIdea.id),
  ).parse(output);
  return {
    ok: true,
    value: applyAssignment(draft, {
      taught: Object.fromEntries(
        Object.entries(parsed.chunks).map(([id, answer]) => [
          chunkIds.real(id),
          answer.kcIds.map(kcIds.real),
        ]),
      ),
      newKcs: Object.entries(parsed.chunks).flatMap(([id, answer]) =>
        answer.newKcs.map((kc) => ({
          ...kc,
          bigIdea: bigIdeaIds.real(kc.bigIdea),
          chunkIds: [chunkIds.real(id)],
        })),
      ),
    }),
  };
}

/**
 * Step 3, one big idea: each KC's type, Bloom level and sharper
 * description, from the chunks that teach it.
 */
export async function fillBigIdea(
  studentId: string,
  bigIdea: DraftBigIdea,
  kcs: Array<DraftKc & { chunks: string[] }>,
): Promise<StepOutcome<Record<string, KcFill>>> {
  "use step";
  const output = await mapCall(studentId, "map-fill", fillCall(bigIdea, kcs));
  if (output === null) return limitReached;
  return {
    ok: true,
    value: fillSchema(kcs.map((kc) => kc.id)).parse(output).kcs,
  };
}

/**
 * Step 4, and again for KCs exercises add: prerequisites, semantic links and
 * prior knowledge of the new KCs (`newKcIds`) over all of the map's KCs,
 * which go to the model by short local ids. When every KC is new, as in a
 * first build, the call links them all.
 */
export async function linkNewKcs(
  studentId: string,
  map: KnowledgeMap,
  newKcIds: string[],
): Promise<StepOutcome<LinksProposal>> {
  "use step";
  const ids = aliases(
    map.kcs.map((kc) => kc.id),
    "k",
  );
  const kcs = map.kcs.map((kc) => ({ ...kc, id: ids.local(kc.id) }));
  const allNew = newKcIds.length === map.kcs.length;
  const output = await mapCall(
    studentId,
    allNew ? "map-links" : "map-added-kc-links",
    allNew ? linksCall(kcs) : addedKcLinksCall(kcs, newKcIds.map(ids.local)),
  );
  if (output === null) return limitReached;
  const proposal = linksSchema(kcs.map((kc) => kc.id)).parse(output);
  const real = <Link extends { from: string; to: string }>(link: Link) => ({
    ...link,
    from: ids.real(link.from),
    to: ids.real(link.to),
  });
  return {
    ok: true,
    value: {
      prerequisites: proposal.prerequisites.map(real),
      semanticLinks: proposal.semanticLinks.map(real),
      priorKcs: proposal.priorKcs.map((prior) => ({
        ...prior,
        requiredBy: prior.requiredBy.map(ids.real),
      })),
    },
  };
}

/**
 * Step 5, one exercise subtask (task `exercise`): the KCs of the linked map
 * it needs, new KCs it needs, its task type, the model's own solution and,
 * when a solution was given, whether that one matches. `taskTypes` are the
 * ones earlier subtasks of the build got, for the model to reuse.
 */
export async function analyseExercise(
  studentId: string,
  exercise: ExerciseInput,
  map: Pick<KnowledgeMap, "bigIdeas" | "kcs">,
  taskTypes: string[],
): Promise<StepOutcome<ExerciseAnswer>> {
  "use step";
  const solutionGiven = exercise.solution !== null;
  const kcIds = aliases(
    map.kcs.map((kc) => kc.id),
    "k",
  );
  const bigIdeaIds = aliases(
    map.bigIdeas.map((bigIdea) => bigIdea.id),
    "b",
  );
  const output = await mapCall(
    studentId,
    "map-exercise",
    exerciseCall({
      exercise: exercise.markdown,
      solution: exercise.solution,
      bigIdeas: map.bigIdeas.map(({ id, name }) => ({
        id: bigIdeaIds.local(id),
        name,
      })),
      kcs: map.kcs.map(({ id, name, description }) => ({
        id: kcIds.local(id),
        name,
        description,
      })),
      taskTypes,
    }),
    "exercise",
  );
  if (output === null) return limitReached;
  const { givenFinalResult, ...answer } = exerciseAnswerSchema
    .extend(givenSolutionSchema.partial().shape)
    .parse(output);
  const given = solutionGiven
    ? givenSolutionSchema.parse({
        givenFinalResult,
        matchesGiven: answer.matchesGiven,
      })
    : null;
  return {
    ok: true,
    value: {
      kcIds: answer.kcIds.map(kcIds.real),
      newKcs: answer.newKcs.map((kc) => ({
        ...kc,
        bigIdea: bigIdeaIds.real(kc.bigIdea),
      })),
      taskType: answer.taskType,
      solution: answer.solution,
      finalResult: answer.finalResult,
      steps: answer.steps,
      given: given && {
        finalResult: given.givenFinalResult,
        matches: given.matchesGiven,
      },
    },
  };
}

/**
 * Step 6, dedup: the vectors of these KC texts (task `embed`), in order,
 * for the Student after checking their Daily limit. Nothing is stored.
 */
export async function embedKcs(
  studentId: string,
  values: string[],
): Promise<StepOutcome<number[][]>> {
  "use step";
  const supabase = createAdminClient();
  const dailyLimit = await checkDailyLimit(supabase, { studentId });
  if (dailyLimit.level === "reached") return limitReached;
  const settings = aiTask("embed");
  const result = await withTraceAttributes(
    { userId: studentId, traceName: "map-dedup-embed" },
    () => embedMany({ ...settings, values }),
  ).catch((error: unknown) => {
    if (isDailyQuotaError(error)) return null;
    throw error;
  });
  if (!result) return limitReached;
  // A provider that reports no usage for embeddings makes `embedMany` sum
  // it to NaN: estimate it from the text then.
  const reported = Number.isFinite(result.usage.tokens);
  await recordAiUsage(
    supabase,
    {
      task: "embed",
      modelId: settings.model,
      usage: reported
        ? {
            inputTokens: result.usage.tokens,
            cachedInputTokens: 0,
            outputTokens: 0,
          }
        : estimatedUsage({ input: values.join(""), output: "" }),
      estimated: !reported,
    },
    { studentId },
  );
  return { ok: true, value: result.embeddings };
}

/**
 * Step 6, dedup: which KCs of each cluster are one KC, as groups of map ids.
 * KCs go to the model by short local ids.
 */
export async function decideMerges(
  studentId: string,
  map: Pick<KnowledgeMap, "kcs">,
  clusters: string[][],
): Promise<StepOutcome<string[][]>> {
  "use step";
  const kcIds = aliases(
    map.kcs.map((kc) => kc.id),
    "k",
  );
  const kc = new Map(map.kcs.map((item) => [item.id, item]));
  const sent = clusters.map((cluster, index) => ({
    id: `g${index + 1}`,
    kcs: cluster.map((id) => ({
      id: kcIds.local(id),
      name: kc.get(id)?.name ?? id,
      description: kc.get(id)?.description ?? "",
    })),
  }));
  const output = await mapCall(studentId, "map-merge", mergeCall(sent));
  if (output === null) return limitReached;
  const parsed = mergeSchema(
    Object.fromEntries(
      sent.map((cluster) => [cluster.id, cluster.kcs.map((item) => item.id)]),
    ),
  ).parse(output);
  return {
    ok: true,
    value: Object.values(parsed.clusters).flatMap((cluster) =>
      cluster.groups.map((group) => group.map(kcIds.real)),
    ),
  };
}

/**
 * The scope step, over the update's new `admin` chunks: one `scope` Finding
 * per remark that excludes or limits exam content, its text the question
 * for the Student and its sources the chunks. Chunks go to the model by
 * short local ids; unknown ones are dropped, and so is a remark left
 * without any.
 */
export async function findScopeRemarks(
  studentId: string,
  adminChunks: MapChunk[],
): Promise<StepOutcome<KnowledgeMap["findings"]>> {
  "use step";
  const ids = aliases(
    adminChunks.map((chunk) => chunk.id),
    "c",
  );
  const local = new Set(adminChunks.map((chunk) => ids.local(chunk.id)));
  const output = await mapCall(
    studentId,
    "map-scope",
    scopeCall(
      adminChunks.map((chunk) => ({
        id: ids.local(chunk.id),
        material: chunk.materialName,
        page: chunk.pageFrom,
        markdown: chunk.markdown,
      })),
    ),
  );
  if (output === null) return limitReached;
  return {
    ok: true,
    value: scopeSchema.parse(output).remarks.flatMap((remark) => {
      const sources = [
        ...new Set(remark.chunkIds.filter((id) => local.has(id))),
      ].map(ids.real);
      return sources.length === 0
        ? []
        : [{ kind: "scope" as const, text: remark.question, sources }];
    }),
  };
}

/**
 * Makes the stored map this one, records the update's new chunks as
 * processed, stores the check report and marks the build built, in one
 * transaction. Rows of the stored map keep their ids. Does nothing when no
 * build runs any more.
 */
export async function storeMap(
  courseId: string,
  map: KnowledgeMap,
  newChunkIds: string[],
  report: CheckReport,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc(
    "apply_knowledge_map_update",
    {
      p_course_id: courseId,
      p_map: knowledgeMapSchema.parse(map),
      p_chunk_ids: newChunkIds,
      p_check_report: report,
    },
  );
  if (error) fail("Storing the knowledge map", error);
}

/** Marks the running build failed with a reason for the Student. */
export async function failBuild(
  courseId: string,
  reason: string,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("knowledge_map_builds")
    .update({ status: "failed", failure_reason: reason })
    .eq("course_id", courseId)
    .eq("status", "building");
  if (error) fail("Recording the failed build", error);
}
