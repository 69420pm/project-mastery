import "server-only";
import {
  PAIRING_TEXT_CHARS,
  pairingAnswerSchema,
  pairingCallSettings,
  pairingMessages,
  type PairingItem,
} from "@/features/ingestion/ai/exercise-pairing";
import {
  chapterPath,
  checkedPairs,
  offeredIds,
  pairingCalls,
  type PairingChunk,
  type PathChapter,
} from "@/features/ingestion/domain/exercise-pairing";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import {
  meteredStream,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { callFits } from "@/lib/ai/call-timeout";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * Step 5 of a parse, and the whole of the workflow after a Material is
 * deleted: pairs every exercise chunk of a Course with its solution chunk,
 * or "no solution". The pairs are recomputed for the whole Course, so upload
 * order does not matter: one call (task `ingest`) sees every exercise and
 * solution chunk of the Course with its Material, Chapter path and first
 * 300 characters, and answers the pairs it is sure of; a Course of more
 * than 400 such chunks goes in calls of at most 400, in Course order.
 *
 * Each pass takes a request number first (`request_exercise_pairing`) and
 * writes only while it is still the Course's latest request
 * (`replace_exercise_solutions`, under the Course row's lock). Of passes
 * that overlap, only the last requested one writes, and an outdated pass
 * stops before its next model call. Two parses that finish together so
 * store what running them one after the other would. A step ends only once
 * every exercise chunk of the Course has a pair row, running a new pass
 * when the one that outdated it has not written.
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

pairCourseStep.maxRetries = RATE_LIMITED_STEP_RETRIES;

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

pairMaterialCourse.maxRetries = RATE_LIMITED_STEP_RETRIES;

/** An exercise or solution chunk with what the pairing call reads of it. */
type CourseChunk = PairingChunk & Omit<PairingItem, "id">;

/** What a pass does at the Daily limit: fail the parse, or store no solution. */
type AtLimit = "fail" | "leave-unpaired";

/** How many passes one step runs before it fails and the step retries. */
const MAX_PASSES = 3;

/**
 * Runs pairing passes until every exercise chunk of the Course has a pair
 * row, the invariant a parse ends with. A pass that a later request
 * outdated writes nothing; when that later pass has not written yet, or
 * never will (its parse failed), this runs a new pass, which is then the
 * latest. Throws after MAX_PASSES, so the step retries. No pass starts a
 * call that could run past the step's limit (`callFits`).
 */
async function pairExercises(
  supabase: AdminSupabase,
  courseId: string,
  atLimit: AtLimit,
): Promise<ParseOutcome> {
  const startedAt = Date.now();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if ((await runPass(supabase, courseId, atLimit, startedAt)) === "limit") {
      return { ok: false, reason: dailyLimitReason };
    }
    if (await everyExerciseHasPair(supabase, courseId)) return { ok: true };
  }
  throw new Error(
    "Pairing left exercises of the Course without a pair: later passes kept outdating this one.",
  );
}

/** Whether every exercise chunk of the Course has a pair row. */
async function everyExerciseHasPair(
  supabase: AdminSupabase,
  courseId: string,
): Promise<boolean> {
  const [exercises, pairs] = await Promise.all([
    allRows("Loading the Course's exercises", (from, to) =>
      supabase
        .from("chunks")
        .select("id")
        .eq("course_id", courseId)
        .eq("label", "exercise")
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the exercise pairs", (from, to) =>
      supabase
        .from("exercise_solutions")
        .select("exercise_chunk_id")
        .eq("course_id", courseId)
        .order("exercise_chunk_id")
        .range(from, to),
    ),
  ]);
  const paired = new Set(pairs.map((pair) => pair.exercise_chunk_id));
  return exercises.every((exercise) => paired.has(exercise.id));
}

/**
 * One pairing pass; it writes only while it is the latest request. "limit"
 * when the Daily limit stopped it and `atLimit` is "fail": it wrote nothing.
 * A call that no longer fits the step started at `stepStartedAt` isn't
 * made: its exercises have no solution until the next pass.
 */
async function runPass(
  supabase: AdminSupabase,
  courseId: string,
  atLimit: AtLimit,
  stepStartedAt: number,
): Promise<"done" | "limit"> {
  const requested = await supabase.rpc("request_exercise_pairing", {
    p_course_id: courseId,
  });
  if (requested.error) failed("Requesting a pairing pass", requested.error);
  // The Course is gone.
  if (requested.data === null) return "done";
  const pass = { courseId, request: requested.data };

  const course = await loadCourse(supabase, courseId);
  if (!course) return "done";

  const solutionOf = new Map<string, string>();
  for (const chunks of pairingCalls(course.chunks)) {
    if (!(await isLatest(supabase, pass))) return "done";
    if (!callFits(stepStartedAt)) break;
    const pairs = await pairByCall(supabase, course.owner, chunks);
    if (!pairs) {
      if (atLimit === "fail") return "limit";
      // What is left has no solution until the next pass.
      break;
    }
    for (const [exercise, solution] of pairs)
      solutionOf.set(exercise, solution);
  }

  const written = await supabase.rpc("replace_exercise_solutions", {
    p_course_id: courseId,
    p_request: pass.request,
    p_pairs: course.chunks
      .filter((chunk) => chunk.label === "exercise")
      .map((exercise) => ({
        exercise_chunk_id: exercise.id,
        solution_chunk_id: solutionOf.get(exercise.id) ?? null,
      })),
  });
  if (written.error) failed("Storing the exercise pairs", written.error);
  return "done";
}

/**
 * The Course's owner and its exercise and solution chunks in Course order
 * (Materials by position, then chunks by position), each with its
 * Material's name, its Chapter path and its first characters. Null when the
 * Course is gone.
 */
async function loadCourse(
  supabase: AdminSupabase,
  courseId: string,
): Promise<{ owner: string; chunks: CourseChunk[] } | null> {
  const course = await supabase
    .from("courses")
    .select("owner")
    .eq("id", courseId)
    .maybeSingle();
  if (course.error) failed("Loading the Course", course.error);
  if (!course.data) return null;

  const [materials, chapters, chunks] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position")
      .order("created_at")
      .order("id"),
    allRows("Loading the Chapters", (from, to) =>
      supabase
        .from("chapters")
        .select("id, parent_id, depth, title")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the Course's exercises", (from, to) =>
      supabase
        .from("chunks")
        .select("id, material_id, position, label, markdown, chapter_id")
        .eq("course_id", courseId)
        .in("label", ["exercise", "solution"])
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  const chapterById = new Map<string, PathChapter>(
    chapters.map((chapter) => [
      chapter.id,
      {
        parentId: chapter.parent_id,
        depth: chapter.depth,
        title: chapter.title,
      },
    ]),
  );
  return {
    owner: course.data.owner,
    chunks: materials.data.flatMap((material) =>
      chunks
        .filter((chunk) => chunk.material_id === material.id)
        .map((chunk) => ({
          id: chunk.id,
          label: chunk.label as PairingChunk["label"],
          material: material.name,
          chapter: chapterPath(chunk.chapter_id, chapterById).join(" > "),
          text: chunk.markdown.slice(0, PAIRING_TEXT_CHARS),
        })),
    ),
  };
}

/**
 * One pairing call over these chunks: the solution chunk of each exercise
 * chunk it pairs, checked in code. An answer that is no valid output pairs
 * nothing. Null when the Daily limit is reached or the provider's daily
 * quota is used up.
 */
async function pairByCall(
  supabase: AdminSupabase,
  owner: string,
  chunks: CourseChunk[],
): Promise<Map<string, string> | null> {
  const offered = offeredIds(chunks);
  const items = (label: PairingChunk["label"]): PairingItem[] =>
    [...offered]
      .filter(([, chunk]) => chunk.label === label)
      .map(([id, chunk]) => ({
        id,
        material: chunk.material,
        chapter: chunk.chapter,
        text: chunk.text,
      }));

  const result = await meteredStream(
    supabase,
    { studentId: owner, task: "ingest", traceName: "pair-exercises" },
    {
      ...pairingCallSettings(),
      messages: pairingMessages(items("exercise"), items("solution")),
    },
  );
  if (!result) return null;
  try {
    const { pairs } = pairingAnswerSchema.parse(await result.output);
    return checkedPairs(pairs, offered);
  } catch (error) {
    console.error("A pairing call gave no valid answer:", error);
    return new Map();
  }
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
  if (error) failed("Loading the Course", error);
  return data?.pairing_requested === pass.request;
}
