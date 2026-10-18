import "server-only";
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
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  fail,
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import { meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminSupabase } from "@/lib/supabase/types";

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
 * what running them one after the other would. A step ends only once every
 * exercise subtask of the Course has a pair row, running a new pass when
 * the one that outdated it has not written.
 */

/** The Course's pairing pass, after one of its Materials was deleted. */
export async function pairCourse(courseId: string): Promise<void> {
  "use workflow";
  await pairCourseStep(courseId);
}

async function pairCourseStep(courseId: string): Promise<void> {
  "use step";
  // No parse to fail: what the Daily limit leaves has no solution until the
  // next pass.
  await pairExercises(createAdminClient(), courseId, "leave-unpaired");
}

/**
 * The pairing pass of a parse, for the Course of its Material. A reached
 * Daily limit ends it with that reason, storing nothing, so the parse fails
 * and a retry pairs again.
 */
export async function pairMaterialCourse(
  materialId: string,
): Promise<ParseOutcome> {
  "use step";
  const supabase = createAdminClient();
  const material = await loadMaterial(supabase, materialId);
  if (!material) return { ok: true };
  return pairExercises(supabase, material.course_id, "fail");
}

type CourseChunks = {
  owner: string;
  exercises: Array<PairingChunk & { markdown: string }>;
  solutions: Array<PairingChunk & { markdown: string }>;
};

/** What a pass does at the Daily limit: fail the parse, or store no solution. */
type AtLimit = "fail" | "leave-unpaired";

/** How many passes one step runs before it fails and the step retries. */
const MAX_PASSES = 3;

/**
 * Runs pairing passes until every exercise subtask of the Course has a pair
 * row, the invariant a parse ends with. A pass that a later request
 * outdated writes nothing; when that later pass has not written yet, or
 * never will (its parse failed), this runs a new pass, which is then the
 * latest. Throws after MAX_PASSES, so the step retries.
 */
async function pairExercises(
  supabase: AdminSupabase,
  courseId: string,
  atLimit: AtLimit,
): Promise<ParseOutcome> {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if ((await runPass(supabase, courseId, atLimit)) === "limit") {
      return { ok: false, reason: dailyLimitReason };
    }
    if (await everySubtaskHasPair(supabase, courseId)) return { ok: true };
  }
  throw new Error(
    "Pairing left exercises of the Course without a pair: later passes kept outdating this one.",
  );
}

/**
 * Whether every exercise subtask of the Course has a pair row. True when
 * the Course is gone.
 */
async function everySubtaskHasPair(
  supabase: AdminSupabase,
  courseId: string,
): Promise<boolean> {
  const course = await loadCourseChunks(supabase, courseId);
  if (!course) return true;
  const { data, error } = await supabase
    .from("exercise_solutions")
    .select("exercise_chunk_id")
    .eq("course_id", courseId);
  if (error) fail("Loading the exercise pairs", error);
  const paired = new Set(data.map((row) => row.exercise_chunk_id));
  return exerciseSubtasks(course.exercises).every((exercise) =>
    paired.has(exercise.id),
  );
}

/**
 * One pairing pass; it writes only while it is the latest request. "limit"
 * when the Daily limit stopped it and `atLimit` is "fail": it wrote nothing.
 */
async function runPass(
  supabase: AdminSupabase,
  courseId: string,
  atLimit: AtLimit,
): Promise<"done" | "limit"> {
  const requested = await supabase.rpc("request_exercise_pairing", {
    p_course_id: courseId,
  });
  if (requested.error) fail("Requesting a pairing pass", requested.error);
  // The Course is gone.
  if (requested.data === null) return "done";
  const request = requested.data;

  const course = await loadCourseChunks(supabase, courseId);
  if (!course) return "done";
  const subtasks = exerciseSubtasks(course.exercises);
  const byNumber = pairByNumber(subtasks, course.solutions);
  const byContent = await pairByContent(
    supabase,
    { courseId, request, studentId: course.owner },
    withMarkdown(byNumber.unpairedExercises, course.exercises),
    withMarkdown(byNumber.unpairedSolutions, course.solutions),
  );
  if (byContent === "outdated") return "done";
  if (byContent === "limit" && atLimit === "fail") return "limit";

  const solutionOf = new Map(
    [...byNumber.pairs, ...(byContent === "limit" ? [] : byContent)].map(
      (pair) => [pair.exerciseId, pair.solutionId],
    ),
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
  return "done";
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
 * empty. "limit" when the Daily limit is reached or the provider's daily
 * quota is used up. "outdated" when a later pass was requested meanwhile,
 * before spending the call.
 */
async function pairByContent(
  supabase: AdminSupabase,
  pass: { courseId: string; request: number; studentId: string },
  exercises: Array<PairingChunk & { markdown: string }>,
  solutions: Array<PairingChunk & { markdown: string }>,
): Promise<ExercisePair[] | "outdated" | "limit"> {
  const offeredExercises = offer(exercises, "e");
  const offeredSolutions = offer(solutions, "s");
  if (!isNonEmpty(offeredExercises) || !isNonEmpty(offeredSolutions)) {
    return [];
  }
  if (!(await isLatest(supabase, pass))) return "outdated";

  const result = await meteredGenerate(
    supabase,
    { studentId: pass.studentId, task: "ingest", traceName: "pair-exercises" },
    {
      ...contentPairingSettings(offeredExercises, offeredSolutions),
      messages: contentPairingMessages(offeredExercises, offeredSolutions),
    },
  );
  if (!result) return "limit";

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
