import "server-only";
import { createHash } from "node:crypto";
import {
  contentPairingMessages,
  contentPairingSchema,
  contentPairingSettings,
  type OfferedExercise,
  type OfferedSolution,
} from "@/features/ingestion/ai/content-pairing";
import {
  batches,
  exerciseSubtasks,
  keyedChunks,
  pairInCode,
  partnerMaterials,
  shortlist,
  type PairingChunk,
  type PairingMaterial,
} from "@/features/ingestion/domain/exercise-pairing";
import { dailyLimitReason } from "@/features/ingestion/domain/parse-failure";
import {
  loadMaterial,
  type ParseOutcome,
} from "@/features/ingestion/workflows/parse-steps";
import {
  meteredGenerate,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * Step 5 of a parse, and the whole of the workflow after a Material is
 * deleted: pairs every exercise subtask of a Course with its solution chunk,
 * or "no solution". The pairs are recomputed for the whole Course, so upload
 * order does not matter: by key within each Material and between partner
 * Materials in code, then what is left by content, in batches of 10
 * exercises per call (task `ingest`), each exercise offered only its
 * shortlist. An exercise whose shortlist is unchanged keeps its stored
 * result without a call (`exercise_solutions.candidates_hash`).
 *
 * Each pass takes a request number first (`request_exercise_pairing`) and
 * writes only while it is still the Course's latest request
 * (`replace_exercise_solutions`, under the Course row's lock). Of passes
 * that overlap, only the last requested one writes, and an outdated pass
 * stops before its next model call. Two parses that finish together so
 * store what running them one after the other would. A step ends only once
 * every exercise subtask of the Course has a pair row, running a new pass
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

type CourseChunks = {
  owner: string;
  materials: PairingMaterial[];
  /** Keyed, Materials by upload, chunks in reading order. */
  chunks: PairingChunk[];
  markdown: Map<string, string>;
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
  const paired = new Set((await loadStoredPairs(supabase, courseId)).keys());
  return exerciseSubtasks(course.chunks).every((exercise) =>
    paired.has(exercise.id),
  );
}

/** A subtask's pair row: its solution or null, and the memo of its call. */
type PairRow = { solutionId: string | null; candidatesHash: string | null };

/** An exercise for the content call, with its shortlist and its memo. */
type Asked = {
  exercise: PairingChunk;
  candidates: PairingChunk[];
  candidatesHash: string;
};

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
  if (requested.error) failed("Requesting a pairing pass", requested.error);
  // The Course is gone.
  if (requested.data === null) return "done";
  const pass = { courseId, request: requested.data };

  const course = await loadCourseChunks(supabase, courseId);
  if (!course) return "done";
  const partners = partnerMaterials(course.materials, course.chunks);
  const code = pairInCode(course.chunks, partners);
  const rows = new Map<string, PairRow>(
    code.pairs.map((pair) => [
      pair.exerciseId,
      { solutionId: pair.solutionId, candidatesHash: null },
    ]),
  );

  const asked: Asked[] = [];
  if (code.exercises.length > 0 && code.solutions.length > 0) {
    const embeddings = await loadEmbeddings(supabase, courseId);
    const stored = await loadStoredPairs(supabase, courseId);
    for (const exercise of code.exercises) {
      const candidates = shortlist(
        exercise,
        code.solutions,
        partners,
        embeddings,
      );
      if (candidates.length === 0) continue;
      const candidatesHash = hashIds(candidates);
      const memo = stored.get(exercise.id);
      if (memo?.candidatesHash === candidatesHash) {
        rows.set(exercise.id, memo);
      } else {
        asked.push({ exercise, candidates, candidatesHash });
      }
    }
  }

  for (const batch of batches(asked)) {
    if (!(await isLatest(supabase, pass))) return "done";
    const solutionOf = await pairByContent(supabase, course, batch);
    if (!solutionOf) {
      if (atLimit === "fail") return "limit";
      // What is left has no solution until the next pass.
      break;
    }
    for (const { exercise, candidatesHash } of batch) {
      rows.set(exercise.id, {
        solutionId: solutionOf.get(exercise.id) ?? null,
        candidatesHash,
      });
    }
  }

  const written = await supabase.rpc("replace_exercise_solutions", {
    p_course_id: courseId,
    p_request: pass.request,
    p_pairs: exerciseSubtasks(course.chunks).map((exercise) => {
      const row = rows.get(exercise.id);
      return {
        exercise_chunk_id: exercise.id,
        solution_chunk_id: row?.solutionId ?? null,
        candidates_hash: row?.candidatesHash ?? null,
      };
    }),
  });
  if (written.error) failed("Storing the exercise pairs", written.error);
  return "done";
}

/** SHA-256 of the chunks' sorted ids: the memo of a shortlist. */
function hashIds(chunks: PairingChunk[]): string {
  const ids = chunks.map((chunk) => chunk.id).toSorted();
  return createHash("sha256").update(ids.join(",")).digest("hex");
}

/**
 * The Course's owner, its Materials by upload and their exercise and
 * solution chunks in reading order, keyed per Material.
 */
async function loadCourseChunks(
  supabase: AdminSupabase,
  courseId: string,
): Promise<CourseChunks | null> {
  const course = await supabase
    .from("courses")
    .select("owner")
    .eq("id", courseId)
    .maybeSingle();
  if (course.error) failed("Loading the Course", course.error);
  if (!course.data) return null;

  const [materials, chunks] = await Promise.all([
    supabase
      .from("materials")
      .select("id, name")
      .eq("course_id", courseId)
      .order("created_at")
      .order("id"),
    supabase
      .from("chunks")
      .select("id, material_id, label, exercise_number, markdown")
      .eq("course_id", courseId)
      .in("label", ["exercise", "solution"])
      .order("position"),
  ]);
  if (materials.error) failed("Loading the Materials", materials.error);
  if (chunks.error) failed("Loading the Course's exercises", chunks.error);
  const pairingMaterials = materials.data.map((material) => ({
    id: material.id,
    name: material.name,
    chunks: chunks.data
      .filter((chunk) => chunk.material_id === material.id)
      .map((chunk) => ({
        id: chunk.id,
        label: chunk.label as PairingChunk["label"],
        exerciseNumber: chunk.exercise_number,
      })),
  }));
  return {
    owner: course.data.owner,
    materials: pairingMaterials,
    chunks: keyedChunks(pairingMaterials),
    markdown: new Map(chunks.data.map((chunk) => [chunk.id, chunk.markdown])),
  };
}

/** The stored embeddings of the Course's exercise and solution chunks. */
async function loadEmbeddings(
  supabase: AdminSupabase,
  courseId: string,
): Promise<Map<string, number[]>> {
  const { data, error } = await supabase
    .from("chunks")
    .select("id, embedding")
    .eq("course_id", courseId)
    .in("label", ["exercise", "solution"]);
  if (error) failed("Loading the chunk embeddings", error);
  return new Map(
    data.flatMap((chunk) =>
      chunk.embedding === null
        ? []
        : [[chunk.id, JSON.parse(chunk.embedding) as number[]]],
    ),
  );
}

/** The Course's stored pair rows, by exercise chunk. */
async function loadStoredPairs(
  supabase: AdminSupabase,
  courseId: string,
): Promise<Map<string, PairRow>> {
  const { data, error } = await supabase
    .from("exercise_solutions")
    .select("exercise_chunk_id, solution_chunk_id, candidates_hash")
    .eq("course_id", courseId);
  if (error) failed("Loading the exercise pairs", error);
  return new Map(
    data.map((row) => [
      row.exercise_chunk_id,
      {
        solutionId: row.solution_chunk_id,
        candidatesHash: row.candidates_hash,
      },
    ]),
  );
}

/**
 * One content call for a batch: each exercise offered with its shortlist,
 * and the union of the shortlists. Code takes the first candidate the call
 * names for each exercise. Null when the Daily limit is reached or the
 * provider's daily quota is used up.
 */
async function pairByContent(
  supabase: AdminSupabase,
  course: CourseChunks,
  batch: Asked[],
): Promise<Map<string, string> | null> {
  const solutions = [
    ...new Map(
      batch.flatMap(({ candidates }) =>
        candidates.map((candidate) => [candidate.id, candidate]),
      ),
    ).values(),
  ];
  const solutionIdOf = new Map(
    solutions.map((solution, index) => [solution.id, `s${index + 1}`]),
  );
  const offeredSolutions = solutions.map((solution): OfferedSolution => ({
    id: solutionIdOf.get(solution.id)!,
    number: solution.exerciseNumber,
    markdown: course.markdown.get(solution.id) ?? "",
  })) as [OfferedSolution, ...OfferedSolution[]];
  const offeredExercises = batch.map(
    ({ exercise, candidates }, index): OfferedExercise => ({
      id: `e${index + 1}`,
      number: exercise.exerciseNumber,
      markdown: course.markdown.get(exercise.id) ?? "",
      candidates: candidates.map((candidate) =>
        solutionIdOf.get(candidate.id)!,
      ),
    }),
  ) as [OfferedExercise, ...OfferedExercise[]];

  const result = await meteredGenerate(
    supabase,
    { studentId: course.owner, task: "ingest", traceName: "pair-exercises" },
    {
      ...contentPairingSettings(offeredExercises, offeredSolutions),
      messages: contentPairingMessages(offeredExercises, offeredSolutions),
    },
  );
  if (!result) return null;

  const { pairs } = contentPairingSchema(
    offeredExercises.map((e) => e.id) as [string, ...string[]],
    offeredSolutions.map((s) => s.id) as [string, ...string[]],
  ).parse(result.output);
  const idOf = (offeredId: string) => Number(offeredId.slice(1)) - 1;
  const paired = new Map<string, string>();
  for (const pair of pairs) {
    const exerciseIndex = idOf(pair.exerciseId);
    const { exercise } = batch[exerciseIndex]!;
    // The first candidate the call names for an exercise.
    if (paired.has(exercise.id)) continue;
    if (
      !offeredExercises[exerciseIndex]!.candidates.includes(pair.solutionId)
    ) {
      continue;
    }
    paired.set(exercise.id, solutions[idOf(pair.solutionId)]!.id);
  }
  return paired;
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
