import "server-only";
import {
  knowledgeMapSchema,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import { allRows } from "@/lib/supabase/all-rows";
import type { AdminSupabase, Supabase } from "@/lib/supabase/types";

/**
 * What an update reads of a Course's stored Knowledge map: the map itself,
 * with stored row ids as its ids, and the chunks earlier updates processed.
 * The build workflow reads them on the admin client, scoped to the Course,
 * and the Chat reads the map on the Student's session client.
 */

/** The ids of the Course's chunks that an update has processed. */
export async function loadProcessedChunkIds(
  supabase: AdminSupabase,
  courseId: string,
): Promise<string[]> {
  const rows = await allRows("Loading the processed chunks", (from, to) =>
    supabase
      .from("knowledge_map_chunks")
      .select("chunk_id")
      .eq("course_id", courseId)
      .order("chunk_id")
      .range(from, to),
  );
  return rows.map((row) => row.chunk_id);
}

/** A Finding the Student has answered in the Brief. */
type AnsweredFinding = {
  text: string;
  answer: string;
  answeredAt: string;
};

/**
 * A stored map with what Priorities reads besides it: the answered
 * Findings in map order, and when the last build finished (null before
 * one finished).
 */
export type StoredMap = KnowledgeMap & {
  answeredFindings: AnsweredFinding[];
  buildFinishedAt: string | null;
};

/**
 * The Course's stored map, with its rows' ids; empty before the first. Reads
 * on the admin client or a Student's session client, where Row Level
 * Security leaves another Student's Course empty.
 */
export async function loadStoredMap(
  supabase: Supabase,
  courseId: string,
): Promise<StoredMap> {
  const [
    bigIdeas,
    kcs,
    sources,
    prerequisites,
    semanticLinks,
    exercises,
    exerciseKcs,
    findings,
    findingSources,
    build,
  ] = await Promise.all([
    allRows("Loading the big ideas", (from, to) =>
      supabase
        .from("big_ideas")
        .select("id, name, description")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the KCs", (from, to) =>
      supabase
        .from("kcs")
        .select("id, big_idea_id, name, description, type, bloom, origin")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the KC sources", (from, to) =>
      supabase
        .from("kc_sources")
        .select("kc_id, chunk_id")
        .eq("course_id", courseId)
        .order("kc_id")
        .order("chunk_id")
        .range(from, to),
    ),
    allRows("Loading the prerequisites", (from, to) =>
      supabase
        .from("prerequisite_links")
        .select("from_kc, to_kc, extraction_confidence")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the semantic links", (from, to) =>
      supabase
        .from("semantic_links")
        .select("from_kc, to_kc, core_type, label")
        .eq("course_id", courseId)
        .order("id")
        .range(from, to),
    ),
    allRows("Loading the exercises", (from, to) =>
      supabase
        .from("exercises")
        .select(
          "id, question_chunk_id, name, task_type, solution_status, solution, difficulty, final_answers",
        )
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the exercise KCs", (from, to) =>
      supabase
        .from("exercise_kcs")
        .select("exercise_id, kc_id")
        .eq("course_id", courseId)
        .order("exercise_id")
        .order("kc_id")
        .range(from, to),
    ),
    allRows("Loading the findings", (from, to) =>
      supabase
        .from("findings")
        .select("id, kind, text, status, answer, answered_at")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the finding sources", (from, to) =>
      supabase
        .from("finding_sources")
        .select("finding_id, chunk_id")
        .eq("course_id", courseId)
        .order("finding_id")
        .order("chunk_id")
        .range(from, to),
    ),
    supabase
      .from("knowledge_map_builds")
      .select("finished_at")
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);
  if (build.error) {
    throw new Error(`Loading the map build failed: ${build.error.message}`);
  }

  const kcOrder = new Map(kcs.map((kc, index) => [kc.id, index]));
  const answeredFindings = findings.flatMap((finding) =>
    finding.status === "answered" &&
    finding.answer !== null &&
    finding.answered_at !== null
      ? [
          {
            text: finding.text,
            answer: finding.answer,
            answeredAt: finding.answered_at,
          },
        ]
      : [],
  );
  const map = knowledgeMapSchema.parse({
    bigIdeas,
    kcs: kcs.map((kc) => ({
      id: kc.id,
      name: kc.name,
      description: kc.description,
      type: kc.type,
      bloom: kc.bloom,
      bigIdea: kc.big_idea_id,
      origin: kc.origin,
      sources: sources
        .filter((source) => source.kc_id === kc.id)
        .map((source) => source.chunk_id),
    })),
    prerequisites: prerequisites.map((link) => ({
      from: link.from_kc,
      to: link.to_kc,
      extractionConfidence: Number(link.extraction_confidence),
    })),
    semanticLinks: semanticLinks.map((link) => ({
      from: link.from_kc,
      to: link.to_kc,
      coreType: link.core_type,
      label: link.label,
    })),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      questionChunk: exercise.question_chunk_id,
      taskType: exercise.task_type,
      solutionStatus: exercise.solution_status,
      solution: exercise.solution,
      difficulty: exercise.difficulty,
      kcs: exerciseKcs
        .filter((link) => link.exercise_id === exercise.id)
        .map((link) => link.kc_id)
        .toSorted((a, b) => (kcOrder.get(a) ?? 0) - (kcOrder.get(b) ?? 0)),
      finalAnswers: exercise.final_answers,
    })),
    findings: findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      text: finding.text,
      sources: findingSources
        .filter((source) => source.finding_id === finding.id)
        .map((source) => source.chunk_id),
    })),
  });
  return {
    ...map,
    answeredFindings,
    buildFinishedAt: build.data?.finished_at ?? null,
  };
}
