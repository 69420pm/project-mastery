import "server-only";
import {
  exerciseExtractionMessages,
  exerciseExtractionSchema,
  exerciseExtractionSettings,
  type OfferedExercisePart,
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
  loadCourseLanguage,
  loadCourseParts,
  PARTS_PER_STEP,
  runCalls,
  touchBuild,
  type CoursePart,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { matchKcs } from "@/features/knowledge-map/workflows/consolidate-steps";
import { meteredGenerate } from "@/features/usage/server";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The exercise steps of a build: one call (task `exercise`) per exercise
 * Part that holds an `exercise` chunk, with its subtasks, their paired
 * solutions and the KCs nearest to them. Each extraction is stored as it
 * finishes in `part_extractions`; the consolidation steps then store its new
 * KCs and its Exercises. A Part is called again when its content changed or
 * a subtask's paired solution is no longer the one it was extracted with.
 */

/** How many KCs an exercise call is offered. */
const CANDIDATE_KCS = 30;

/** Parallel `match_kcs` calls. */
const MATCHES_AT_ONCE = 10;

/** An exercise chunk, as the step reads it. */
type ExerciseChunk = {
  id: string;
  part_id: string | null;
  exercise_number: string | null;
};

/**
 * Extracts up to PARTS_PER_STEP exercise Parts that need it, in Course
 * order, at most AI_CONCURRENCY calls at a time. A reached Daily limit stops
 * the build; what is stored stays.
 */
export async function extractExercises(courseId: string): Promise<StepOutcome> {
  "use step";
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const [parts, stored, chunks, pairs] = await Promise.all([
    loadCourseParts(supabase, courseId),
    supabase
      .from("part_extractions")
      .select("part_id, content_hash, output")
      .eq("course_id", courseId),
    allRows("Loading the exercise chunks", (from, to) =>
      supabase
        .from("chunks")
        .select("id, part_id, exercise_number")
        .eq("course_id", courseId)
        .eq("label", "exercise")
        .order("material_id")
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the exercise pairs", (from, to) =>
      supabase
        .from("exercise_solutions")
        .select("exercise_chunk_id, solution_chunk_id")
        .eq("course_id", courseId)
        .order("exercise_chunk_id")
        .range(from, to),
    ),
  ]);
  if (stored.error) failed("Loading the Part extractions", stored.error);
  const extractionOf = new Map(
    stored.data.map((row) => [
      row.part_id,
      {
        contentHash: row.content_hash,
        exercises: storedExtractionSchema.parse(row.output).exercises,
      },
    ]),
  );
  const pairOf = new Map(
    pairs.map((pair) => [pair.exercise_chunk_id, pair.solution_chunk_id]),
  );
  const solutionOf = (chunkId: string) => pairOf.get(chunkId) ?? null;
  const chunksOf = (partId: string) =>
    chunks.filter((chunk) => chunk.part_id === partId);

  const todo = parts.filter((part) => {
    const exerciseChunkIds = chunksOf(part.id).map((chunk) => chunk.id);
    return (
      part.kind === "exercise" &&
      exerciseChunkIds.length > 0 &&
      needsExerciseExtraction(
        extractionOf.get(part.id),
        { contentHash: part.contentHash, exerciseChunkIds },
        solutionOf,
      )
    );
  });
  if (todo.length === 0) return { ok: true, left: 0 };

  const batch = todo.slice(0, PARTS_PER_STEP);
  const batchChunks = batch.flatMap((part) => chunksOf(part.id));
  const [language, texts, candidates] = await Promise.all([
    loadCourseLanguage(supabase, courseId),
    loadMarkdowns(supabase, [
      ...batchChunks.map((chunk) => chunk.id),
      ...batchChunks.flatMap((chunk) => solutionOf(chunk.id) ?? []),
    ]),
    loadCandidates(supabase, courseId, batch, batchChunks),
  ]);

  let done = 0;
  let limitReached = false;
  await runCalls(batch, async (part) => {
    const extraction = await extractPart(supabase, owner, {
      part,
      language,
      chunks: chunksOf(part.id),
      texts,
      solutionOf,
      candidates: candidates.get(part.id) ?? [],
    });
    if (extraction === "limit") {
      limitReached = true;
      return "stop";
    }
    const { error } = await supabase.from("part_extractions").upsert(
      {
        part_id: part.id,
        owner,
        course_id: courseId,
        content_hash: part.contentHash,
        output: extraction,
        kc_ids: null,
        assumes_matched: false,
      },
      { onConflict: "part_id" },
    );
    if (error) failed("Storing an exercise extraction", error);
    done += 1;
  });
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: todo.length - done };
}

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
    if (error) failed("Loading the exercise texts", error);
    for (const chunk of data) markdowns.set(chunk.id, chunk.markdown);
  }
  return markdowns;
}

type Candidate = { id: string; name: string; description: string };

/**
 * Each Part's CANDIDATE_KCS live KCs nearest to any of its exercise chunks,
 * most alike first.
 */
async function loadCandidates(
  supabase: AdminSupabase,
  courseId: string,
  parts: readonly CoursePart[],
  chunks: readonly ExerciseChunk[],
): Promise<Map<string, Candidate[]>> {
  const embeddings: Array<{ id: string; embedding: string | null }> = [];
  const ids = chunks.map((chunk) => chunk.id);
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
          const partId = chunks.find((chunk) => chunk.id === id)!.part_id!;
          const matches = await matchKcs(
            supabase,
            courseId,
            embedding,
            CANDIDATE_KCS,
            false,
          );
          const scores = best.get(partId) ?? new Map<string, number>();
          for (const match of matches) {
            scores.set(
              match.id,
              Math.max(scores.get(match.id) ?? -1, match.similarity),
            );
          }
          best.set(partId, scores);
        }),
    );
  }

  const chosen = new Map(
    parts.map((part) => [
      part.id,
      [...(best.get(part.id) ?? new Map<string, number>())]
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
    [...chosen].map(([partId, ids]) => [
      partId,
      ids.flatMap((id) => kcs.get(id) ?? []),
    ]),
  );
}

/** One exercise Part's call, checked; "limit" when the Daily limit is reached. */
async function extractPart(
  supabase: AdminSupabase,
  owner: string,
  {
    part,
    language,
    chunks,
    texts,
    solutionOf,
    candidates,
  }: {
    part: CoursePart;
    language: string;
    chunks: ExerciseChunk[];
    texts: ReadonlyMap<string, string>;
    solutionOf: (chunkId: string) => string | null;
    candidates: Candidate[];
  },
): Promise<StoredExtraction | "limit"> {
  const subtasks = chunks.map((chunk, index): OfferedSubtask => {
    const solutionChunkId = solutionOf(chunk.id);
    return {
      id: `s${index + 1}`,
      chunkId: chunk.id,
      solutionChunkId,
      solution: (solutionChunkId && texts.get(solutionChunkId)) ?? null,
    };
  });
  const offeredKcs = candidates.map((kc, index) => ({
    id: `k${index + 1}`,
    name: kc.name,
    description: kc.description,
  }));
  const offered: OfferedExercisePart = {
    title: part.title,
    chapterTitle: part.chapterTitle,
    language,
    subtasks: subtasks.map((subtask, index) => ({
      id: subtask.id,
      number: chunks[index]!.exercise_number,
      statement: texts.get(subtask.chunkId) ?? "",
      solution: subtask.solution,
    })),
    kcs: offeredKcs,
  };
  const result = await meteredGenerate(
    supabase,
    { studentId: owner, task: "exercise", traceName: "extract-exercises" },
    {
      ...exerciseExtractionSettings(),
      messages: exerciseExtractionMessages(offered),
    },
  );
  if (!result) return "limit";
  const answer = exerciseExtractionSchema.parse(result.output);
  const { kcs, exercises } = checkExerciseAnswer(
    answer,
    subtasks,
    new Map(offeredKcs.map((kc, index) => [kc.id, candidates[index]!.id])),
  );
  return { kcs, prerequisites: [], exercises };
}
