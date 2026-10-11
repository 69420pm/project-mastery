import "server-only";
import { generateText } from "ai";
import {
  contentPairingMessages,
  contentPairingSchema,
  contentPairingSettings,
  type OfferedChunk,
} from "@/features/ingestion/ai/content-pairing";
import {
  exerciseSubtasks,
  pairByNumber,
  type ExercisePair,
  type PairingChunk,
} from "@/features/ingestion/domain/exercise-pairing";
import {
  dailyQuotaAsNull,
  fail,
  loadMaterial,
} from "@/features/ingestion/workflows/parse-steps";
import { checkDailyLimit, recordAiUsage } from "@/features/usage/server";
import { tokenUsage } from "@/lib/ai/cost";
import { answeringModel } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";
import { withTraceAttributes } from "@/lib/tracing";

/**
 * Step 5 of a parse, and the whole of the workflow after a Material is
 * deleted: pairs every exercise subtask of a Course with its solution chunk,
 * or "no solution". The pairs are recomputed for the whole Course, so upload
 * order does not matter: by normalized number first, then what is left in
 * one content-matching call (task `ingest`), and the rest has no solution.
 *
 * Each pass takes a request number first (`request_exercise_pairing`) and
 * writes only while it is still the Course's latest request
 * (`replace_exercise_solutions`, under the Course row's lock). Of passes
 * that overlap, only the last requested one writes, and an outdated pass
 * stops before its model call. Two parses that finish together so store
 * what running them one after the other would.
 */

/** The Course's pairing pass, after one of its Materials was deleted. */
export async function pairCourse(courseId: string): Promise<void> {
  "use workflow";
  await pairCourseStep(courseId);
}

async function pairCourseStep(courseId: string): Promise<void> {
  "use step";
  await pairExercises(createAdminClient(), courseId);
}

/** The pairing pass of a parse, for the Course of its Material. */
export async function pairMaterialCourse(materialId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return;
  await pairExercises(supabase, material.course_id);
}

type CourseChunks = {
  owner: string;
  exercises: Array<PairingChunk & { markdown: string }>;
  solutions: Array<PairingChunk & { markdown: string }>;
};

async function pairExercises(
  supabase: AdminSupabase,
  courseId: string,
): Promise<void> {
  const requested = await supabase.rpc("request_exercise_pairing", {
    p_course_id: courseId,
  });
  if (requested.error) fail("Requesting a pairing pass", requested.error);
  // The Course is gone.
  if (requested.data === null) return;
  const request = requested.data;

  const course = await loadCourseChunks(supabase, courseId);
  if (!course) return;
  const subtasks = exerciseSubtasks(course.exercises);
  const byNumber = pairByNumber(subtasks, course.solutions);
  const byContent = await pairByContent(
    supabase,
    { courseId, request, studentId: course.owner },
    withMarkdown(byNumber.unpairedExercises, course.exercises),
    withMarkdown(byNumber.unpairedSolutions, course.solutions),
  );
  if (byContent === "outdated") return;

  const solutionOf = new Map(
    [...byNumber.pairs, ...byContent].map((pair) => [
      pair.exerciseId,
      pair.solutionId,
    ]),
  );
  const written = await supabase.rpc("replace_exercise_solutions", {
    p_course_id: courseId,
    p_request: request,
    p_pairs: subtasks.map((exercise) => ({
      exercise_chunk_id: exercise.id,
      solution_chunk_id: solutionOf.get(exercise.id) ?? null,
    })),
  });
  if (written.error) fail("Storing the exercise pairs", written.error);
}

/** The Course's owner with its exercise and solution chunks, in order. */
async function loadCourseChunks(
  supabase: AdminSupabase,
  courseId: string,
): Promise<CourseChunks | null> {
  const course = await supabase
    .from("courses")
    .select("owner")
    .eq("id", courseId)
    .maybeSingle();
  if (course.error) fail("Loading the Course", course.error);
  if (!course.data) return null;

  const chunks = await supabase
    .from("chunks")
    .select("id, material_id, label, exercise_number, markdown")
    .eq("course_id", courseId)
    .in("label", ["exercise", "solution"])
    .order("material_id")
    .order("position");
  if (chunks.error) fail("Loading the Course's exercises", chunks.error);
  const ofLabel = (label: string) =>
    chunks.data
      .filter((chunk) => chunk.label === label)
      .map((chunk) => ({
        id: chunk.id,
        materialId: chunk.material_id,
        exerciseNumber: chunk.exercise_number,
        markdown: chunk.markdown,
      }));
  return {
    owner: course.data.owner,
    exercises: ofLabel("exercise"),
    solutions: ofLabel("solution"),
  };
}

function withMarkdown(
  chunks: PairingChunk[],
  all: Array<PairingChunk & { markdown: string }>,
) {
  return chunks.flatMap(
    (chunk) => all.find((one) => one.id === chunk.id) ?? [],
  );
}

/**
 * Pairs what numbers left by content, in one call: none when either side is
 * empty, the Daily limit is reached or the provider's daily quota is used
 * up, so those exercises have no solution until the next pass. "outdated"
 * when a later pass was requested meanwhile, before spending the call.
 */
async function pairByContent(
  supabase: AdminSupabase,
  pass: { courseId: string; request: number; studentId: string },
  exercises: Array<PairingChunk & { markdown: string }>,
  solutions: Array<PairingChunk & { markdown: string }>,
): Promise<ExercisePair[] | "outdated"> {
  const offeredExercises = offer(exercises, "e");
  const offeredSolutions = offer(solutions, "s");
  if (!isNonEmpty(offeredExercises) || !isNonEmpty(offeredSolutions)) {
    return [];
  }
  if (!(await isLatest(supabase, pass))) return "outdated";

  const { studentId } = pass;
  const dailyLimit = await checkDailyLimit(supabase, { studentId });
  if (dailyLimit.level === "reached") return [];
  const settings = contentPairingSettings(offeredExercises, offeredSolutions);
  const result = await withTraceAttributes(
    { userId: studentId, traceName: "pair-exercises" },
    () =>
      generateText({
        ...settings,
        messages: contentPairingMessages(offeredExercises, offeredSolutions),
      }),
  ).catch(dailyQuotaAsNull);
  if (!result) return [];
  await recordAiUsage(
    supabase,
    {
      task: "ingest",
      modelId: answeringModel(settings, result.response.modelId),
      usage: tokenUsage(result.usage),
    },
    { studentId },
  );

  const ids = (offered: OfferedChunk[]) =>
    offered.map((chunk) => chunk.id) as [string, ...string[]];
  const { pairs } = contentPairingSchema(
    ids(offeredExercises),
    ids(offeredSolutions),
  ).parse(result.output);
  const idOf = (offeredId: string) => Number(offeredId.slice(1)) - 1;
  const paired = new Map<string, string>();
  for (const pair of pairs) {
    const exercise = exercises[idOf(pair.exerciseId)]!;
    // The first solution the call names for an exercise.
    if (paired.has(exercise.id)) continue;
    paired.set(exercise.id, solutions[idOf(pair.solutionId)]!.id);
  }
  return [...paired].map(([exerciseId, solutionId]) => ({
    exerciseId,
    solutionId,
  }));
}

/** The chunks as the call is offered them, with ids such as e1, e2. */
function offer(
  chunks: Array<PairingChunk & { markdown: string }>,
  prefix: string,
): OfferedChunk[] {
  return chunks.map((chunk, index) => ({
    id: `${prefix}${index + 1}`,
    number: chunk.exerciseNumber,
    markdown: chunk.markdown,
  }));
}

function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0;
}

/** Whether the pass is still the Course's latest pairing request. */
async function isLatest(
  supabase: AdminSupabase,
  pass: { courseId: string; request: number },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("courses")
    .select("pairing_requested")
    .eq("id", pass.courseId)
    .maybeSingle();
  if (error) fail("Loading the Course", error);
  return data?.pairing_requested === pass.request;
}
