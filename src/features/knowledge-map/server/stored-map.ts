import "server-only";
import {
  knowledgeMapSchema,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import { allRows } from "@/lib/supabase/all-rows";
import type { Supabase } from "@/lib/supabase/types";

/**
 * A Course's stored Knowledge map, with stored row ids as its ids. The Chat,
 * the plan and the workflows read it.
 */

/**
 * The Course's stored map, with its rows' ids; empty before the first. Reads
 * on the admin client or a Student's session client, where Row Level
 * Security leaves another Student's Course empty.
 */
export async function loadStoredMap(
  supabase: Supabase,
  courseId: string,
): Promise<KnowledgeMap> {
  const [bigIdeas, kcs, sources, prerequisites, exercises, exerciseKcs] =
    await Promise.all([
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
          .select("id, big_idea_id, name, description, type, origin")
          .eq("course_id", courseId)
          .is("retired_at", null)
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
          .select("from_kc, to_kc")
          .eq("course_id", courseId)
          .order("id")
          .range(from, to),
      ),
      allRows("Loading the exercises", (from, to) =>
        supabase
          .from("exercises")
          .select(
            "id, question_chunk_id, solution_chunk_id, difficulty, final_answers",
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
    ]);

  const kcOrder = new Map(kcs.map((kc, index) => [kc.id, index]));
  return knowledgeMapSchema.parse({
    bigIdeas,
    kcs: kcs.map((kc) => ({
      id: kc.id,
      name: kc.name,
      description: kc.description,
      type: kc.type,
      bigIdea: kc.big_idea_id,
      origin: kc.origin,
      sources: sources
        .filter((source) => source.kc_id === kc.id)
        .map((source) => source.chunk_id),
    })),
    // A retired KC is out of the map, with its links.
    prerequisites: prerequisites
      .filter((link) => kcOrder.has(link.from_kc) && kcOrder.has(link.to_kc))
      .map((link) => ({ from: link.from_kc, to: link.to_kc })),
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      questionChunk: exercise.question_chunk_id,
      solutionChunk: exercise.solution_chunk_id,
      difficulty: exercise.difficulty,
      kcs: exerciseKcs
        .filter(
          (link) => link.exercise_id === exercise.id && kcOrder.has(link.kc_id),
        )
        .map((link) => link.kc_id)
        .toSorted((a, b) => (kcOrder.get(a) ?? 0) - (kcOrder.get(b) ?? 0)),
      finalAnswers: exercise.final_answers,
    })),
  });
}
