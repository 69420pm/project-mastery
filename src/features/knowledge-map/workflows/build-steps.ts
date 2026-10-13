import "server-only";
import { generateText } from "ai";
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
  assignmentCall,
  assignmentSchema,
  fillCall,
  fillSchema,
  linksCall,
  linksSchema,
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
import {
  knowledgeMapSchema,
  type CheckReport,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import type { MapChunk } from "@/features/knowledge-map/types";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { isDailyQuotaError } from "@/lib/ai/daily-quota";
import { answeringModel, type AiTask } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * The steps of a Knowledge map build (`build-knowledge-map.ts`). Each runs on
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
 * What a build reads once: whose Course it is, its chunks and its exercise
 * subtasks with their paired solutions.
 */
export type BuildInput = {
  studentId: string;
  chunks: MapChunk[];
  exercises: ExerciseInput[];
};

/**
 * The owner, chunks and exercise subtasks of the Course whose build runs.
 * Null when no build runs any more, as when the Course was deleted.
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
  const [chunks, pairs] = await Promise.all([
    loadCourseChunks(supabase, courseId),
    loadExerciseSolutions(supabase, courseId),
  ]);
  return {
    studentId: data.owner,
    chunks: chunks.map(({ id, materialName, label, markdown }) => ({
      id,
      materialName,
      label,
      markdown,
    })),
    exercises: exerciseInputs(chunks, pairs),
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
    providerOptions?: { gateway?: { models: readonly string[] } };
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

/** Step 1: big ideas and candidate KCs from the Course's outline. */
export async function draftSkeleton(
  studentId: string,
  input: SkeletonInput,
): Promise<StepOutcome<Draft>> {
  "use step";
  const output = await mapCall(studentId, "map-skeleton", skeletonCall(input));
  if (output === null) return limitReached;
  return { ok: true, value: draftFromSkeleton(skeletonSchema.parse(output)) };
}

/**
 * Step 2, one batch: which KCs each chunk teaches, and new KCs the chunks
 * teach. Chunks go to the model by short local ids.
 */
export async function assignBatch(
  studentId: string,
  draft: Draft,
  batch: MapChunk[],
): Promise<StepOutcome<Draft>> {
  "use step";
  const local = batch.map((chunk, index) => ({
    id: `c${index + 1}`,
    chunk,
  }));
  const chunkId = (localId: string) =>
    local.find((entry) => entry.id === localId)?.chunk.id ?? localId;
  const output = await mapCall(
    studentId,
    "map-assignment",
    assignmentCall(
      draft.bigIdeas,
      draft.kcs,
      local.map(({ id, chunk }) => ({
        id,
        label: chunk.label,
        markdown: chunk.markdown,
      })),
    ),
  );
  if (output === null) return limitReached;
  const parsed = assignmentSchema(
    local.map((entry) => entry.id),
    draft.kcs.map((kc) => kc.id),
    draft.bigIdeas.map((bigIdea) => bigIdea.id),
  ).parse(output);
  return {
    ok: true,
    value: applyAssignment(draft, {
      taught: Object.fromEntries(
        Object.entries(parsed.chunks).map(([id, { kcIds }]) => [
          chunkId(id),
          kcIds,
        ]),
      ),
      newKcs: Object.entries(parsed.chunks).flatMap(([id, { newKcs }]) =>
        newKcs.map((kc) => ({ ...kc, chunkIds: [chunkId(id)] })),
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
 * Step 4: prerequisites, semantic links and prior knowledge over all of the
 * map's KCs, which go to the model by their local ids.
 */
export async function linkKcs(
  studentId: string,
  map: KnowledgeMap,
): Promise<StepOutcome<LinksProposal>> {
  "use step";
  const output = await mapCall(studentId, "map-links", linksCall(map.kcs));
  if (output === null) return limitReached;
  return {
    ok: true,
    value: linksSchema(map.kcs.map((kc) => kc.id)).parse(output),
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
  const output = await mapCall(
    studentId,
    "map-exercise",
    exerciseCall({
      exercise: exercise.markdown,
      solution: exercise.solution,
      bigIdeas: map.bigIdeas.map(({ id, name }) => ({ id, name })),
      kcs: map.kcs.map(({ id, name, description }) => ({
        id,
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
      kcIds: answer.kcIds,
      newKcs: answer.newKcs,
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
 * Stores the map with its check report and marks the build built, in one
 * transaction. Does nothing when no build runs any more.
 */
export async function storeMap(
  courseId: string,
  map: KnowledgeMap,
  report: CheckReport,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("replace_knowledge_map", {
    p_course_id: courseId,
    p_map: knowledgeMapSchema.parse(map),
    p_check_report: report,
  });
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
