import "server-only";
import {
  exerciseExtractionMessages,
  exerciseExtractionSchema,
  exerciseExtractionSettings,
  type OfferedExerciseUnit,
} from "@/features/knowledge-map/ai/exercise-extraction";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  checkExerciseAnswer,
  needsExerciseExtraction,
  type OfferedSubtask,
} from "@/features/knowledge-map/domain/exercise-extraction";
import {
  storedExtractionSchema,
  type StoredExtraction,
} from "@/features/knowledge-map/schemas";
import {
  buildCall,
  loadCourseLanguage,
  loadCourseUnits,
  loadStoredUnits,
  runCalls,
  storeExtraction,
  touchBuild,
  unitKey,
  UNITS_PER_STEP,
  type CourseUnit,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { matchKcs } from "@/features/knowledge-map/workflows/consolidate-steps";
import { RATE_LIMITED_STEP_RETRIES } from "@/features/usage/server";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The exercise steps of a build: one call (task `exercise`) per exercise
 * unit, with its subtasks, their paired solutions and the KCs nearest to
 * them. Each extraction is stored as it finishes in `chapter_extractions`;
 * the consolidation steps then store its new KCs and its Exercises. A unit
 * is called again when its content changed or a subtask's paired solution
 * is no longer the one it was extracted with.
 */

/** How many KCs an exercise call is offered. */
const CANDIDATE_KCS = 30;

/** Parallel `match_kcs` calls. */
const MATCHES_AT_ONCE = 10;

/**
 * Extracts up to UNITS_PER_STEP exercise units that need it, in Course
 * order, at most AI_CONCURRENCY calls at a time. A reached Daily limit stops
 * the build; what is stored stays.
 */
export async function extractExercises(courseId: string): Promise<StepOutcome> {
  "use step";
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const [units, stored, pairs] = await Promise.all([
    loadCourseUnits(supabase, courseId, "exercise"),
    loadStoredUnits(supabase, courseId),
    allRows("Loading the exercise pairs", (from, to) =>
      supabase
        .from("exercise_solutions")
        .select("exercise_chunk_id, solution_chunk_id")
        .eq("course_id", courseId)
        .order("exercise_chunk_id")
        .range(from, to),
    ),
  ]);
  const extractionOf = new Map(
    stored.map((row) => [
      row.key,
      {
        contentHash: row.contentHash,
        exercises: storedExtractionSchema.parse(row.output).exercises,
      },
    ]),
  );
  const pairOf = new Map(
    pairs.map((pair) => [pair.exercise_chunk_id, pair.solution_chunk_id]),
  );
  const solutionOf = (chunkId: string) => pairOf.get(chunkId) ?? null;

  const todo = units.filter((unit) =>
    needsExerciseExtraction(
      extractionOf.get(unitKey(unit)),
      {
        contentHash: unit.contentHash,
        exerciseChunkIds: unit.chunks.map((chunk) => chunk.id),
      },
      solutionOf,
    ),
  );
  if (todo.length === 0) return { ok: true, left: 0 };

  const batch = todo.slice(0, UNITS_PER_STEP);
  const [language, solutions, candidates] = await Promise.all([
    loadCourseLanguage(supabase, courseId),
    loadMarkdowns(
      supabase,
      batch.flatMap((unit) =>
        unit.chunks.flatMap((chunk) => solutionOf(chunk.id) ?? []),
      ),
    ),
    loadCandidates(supabase, courseId, batch),
  ]);

  let done = 0;
  let limitReached = false;
  await runCalls(batch, async (unit) => {
    const extraction = await extractUnit(supabase, owner, {
      unit,
      language,
      solutions,
      solutionOf,
      candidates: candidates.get(unitKey(unit)) ?? [],
    });
    if (extraction === "limit") {
      limitReached = true;
      return "stop";
    }
    await storeExtraction(supabase, { owner, courseId, unit }, extraction);
    done += 1;
  });
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: todo.length - done };
}

extractExercises.maxRetries = RATE_LIMITED_STEP_RETRIES;

/** The Markdown of these chunks by id; deleted ones are missing. */
async function loadMarkdowns(
  supabase: AdminSupabase,
  chunkIds: string[],
): Promise<Map<string, string>> {
  const markdowns = new Map<string, string>();
  const ids = [...new Set(chunkIds)];
  // Ids go in the query string, so long lists are read in slices.
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, markdown")
      .in("id", ids.slice(start, start + 100));
    if (error) failed("Loading the solution texts", error);
    for (const chunk of data) markdowns.set(chunk.id, chunk.markdown);
  }
  return markdowns;
}

type Candidate = { id: string; name: string; description: string };

/**
 * Each unit's CANDIDATE_KCS live KCs nearest to any of its exercise chunks,
 * most alike first, by `unitKey`.
 */
async function loadCandidates(
  supabase: AdminSupabase,
  courseId: string,
  units: readonly CourseUnit[],
): Promise<Map<string, Candidate[]>> {
  const unitOf = new Map(
    units.flatMap((unit) =>
      unit.chunks.map((chunk) => [chunk.id, unitKey(unit)] as const),
    ),
  );
  const ids = [...unitOf.keys()];
  const embeddings: Array<{ id: string; embedding: string | null }> = [];
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, embedding")
      .in("id", ids.slice(start, start + 100));
    if (error) failed("Loading the exercise vectors", error);
    embeddings.push(...data);
  }

  const best = new Map<string, Map<string, number>>();
  for (let start = 0; start < embeddings.length; start += MATCHES_AT_ONCE) {
    await Promise.all(
      embeddings
        .slice(start, start + MATCHES_AT_ONCE)
        .map(async ({ id, embedding }) => {
          if (!embedding) return;
          const key = unitOf.get(id)!;
          const matches = await matchKcs(
            supabase,
            courseId,
            embedding,
            CANDIDATE_KCS,
            false,
          );
          const scores = best.get(key) ?? new Map<string, number>();
          for (const match of matches) {
            scores.set(
              match.id,
              Math.max(scores.get(match.id) ?? -1, match.similarity),
            );
          }
          best.set(key, scores);
        }),
    );
  }

  const chosen = new Map(
    [...best].map(([key, scores]) => [
      key,
      [...scores]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, CANDIDATE_KCS)
        .map(([id]) => id),
    ]),
  );
  const kcIds = [...new Set([...chosen.values()].flat())];
  const kcs = new Map<string, Candidate>();
  for (let start = 0; start < kcIds.length; start += 100) {
    const { data, error } = await supabase
      .from("kcs")
      .select("id, name, description")
      .in("id", kcIds.slice(start, start + 100));
    if (error) failed("Loading the candidate KCs", error);
    for (const kc of data) kcs.set(kc.id, kc);
  }
  return new Map(
    [...chosen].map(([key, ids]) => [
      key,
      ids.flatMap((id) => kcs.get(id) ?? []),
    ]),
  );
}

/** One exercise unit's call, checked; "limit" when the Daily limit is reached. */
async function extractUnit(
  supabase: AdminSupabase,
  owner: string,
  {
    unit,
    language,
    solutions,
    solutionOf,
    candidates,
  }: {
    unit: CourseUnit;
    language: string;
    solutions: ReadonlyMap<string, string>;
    solutionOf: (chunkId: string) => string | null;
    candidates: Candidate[];
  },
): Promise<StoredExtraction | "limit"> {
  const subtasks = unit.chunks.map((chunk, index): OfferedSubtask => {
    const solutionChunkId = solutionOf(chunk.id);
    return {
      id: `s${index + 1}`,
      chunkId: chunk.id,
      solutionChunkId,
      solution: (solutionChunkId && solutions.get(solutionChunkId)) ?? null,
    };
  });
  const offeredKcs = candidates.map((kc, index) => ({
    id: `k${index + 1}`,
    name: kc.name,
    description: kc.description,
  }));
  const offered: OfferedExerciseUnit = {
    material: unit.materialName,
    outline: unit.outline,
    language,
    subtasks: subtasks.map((subtask, index) => ({
      id: subtask.id,
      statement: unit.chunks[index]!.markdown,
      solution: subtask.solution,
    })),
    kcs: offeredKcs,
  };
  const answer = await buildCall(
    supabase,
    { studentId: owner, task: "exercise", traceName: "extract-exercises" },
    {
      ...exerciseExtractionSettings(offered),
      messages: exerciseExtractionMessages(offered),
    },
    exerciseExtractionSchema(),
  );
  if (answer === "limit") return "limit";
  const { kcs, exercises } = checkExerciseAnswer(
    answer,
    subtasks,
    new Map(offeredKcs.map((kc, index) => [kc.id, candidates[index]!.id])),
  );
  return { kcs, prerequisites: [], exercises };
}
