import "server-only";
import { z } from "zod";
import {
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import type { FinalAnswer } from "@/features/knowledge-map";
import { finalAnswerSchema } from "@/features/knowledge-map/server";
import {
  byPointsLost,
  type GradedStep,
} from "@/features/study/domain/mock-grading";
import type { MockReviewItem, MockTaskGrade } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * What a graded Mock exam's page and its Results session read besides the
 * mock (#186): each task's grade and reference solution, and the
 * Student's calibration on sure answers.
 */

const stepsSchema = z.array(
  z.object({ points: z.number(), reason: z.string() }),
);

/** A task's grade from its item's columns; null until grading finished. */
export function taskGrade(item: {
  graded_at: string | null;
  points_awarded: number | null;
  steps: unknown;
  check: string | null;
}): MockTaskGrade | null {
  if (item.graded_at === null) return null;
  if (item.points_awarded === null) return { status: "failed" };
  const steps = stepsSchema.safeParse(item.steps);
  return {
    status: "graded",
    pointsAwarded: item.points_awarded,
    steps: steps.success ? (steps.data satisfies GradedStep[]) : [],
    check:
      item.check === "match" || item.check === "mismatch" ? item.check : null,
  };
}

/**
 * The item's reference solution and final answers: its Exercise's (its
 * solution, else its paired solution chunk) or its Problem's.
 */
export async function loadItemSource(
  supabase: Supabase,
  courseId: string,
  item: { exercise_id: string | null; problem_id: string | null },
): Promise<{ reference: string | null; keys: FinalAnswer[] | null }> {
  const keysOf = (value: unknown) => {
    const parsed = z.array(finalAnswerSchema).safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  if (item.problem_id !== null) {
    const { data, error } = await supabase
      .from("problems")
      .select("solution, final_answers")
      .eq("id", item.problem_id)
      .maybeSingle();
    if (error) failed("Loading the item's Problem", error);
    return {
      reference: data?.solution ?? null,
      keys: keysOf(data?.final_answers),
    };
  }
  if (item.exercise_id === null) return { reference: null, keys: null };
  const { data, error } = await supabase
    .from("exercises")
    .select("question_chunk_id, final_answers")
    .eq("id", item.exercise_id)
    .maybeSingle();
  if (error) failed("Loading the item's Exercise", error);
  if (!data) return { reference: null, keys: null };
  // The printed solution, when the Materials have one.
  let reference: string | null = null;
  const paired = (await loadExerciseSolutions(supabase, courseId))[
    data.question_chunk_id
  ];
  if (paired) {
    const [chunk] = await loadChunkSources(supabase, [paired]);
    reference = chunk?.markdown ?? null;
  }
  return { reference, keys: keysOf(data.final_answers) };
}

/**
 * A graded Mock exam's items for its Results session, the most points lost
 * first, each with the Student's answer, its grade, its reference solution
 * and its KCs, named from the map's `kcs`.
 */
export async function loadMockReview(
  supabase: Supabase,
  courseId: string,
  mockId: string,
  mapKcs: Array<{ id: string; name: string }>,
): Promise<MockReviewItem[]> {
  const kcName = (id: string) => mapKcs.find((kc) => kc.id === id)?.name ?? id;
  const { data: items, error } = await supabase
    .from("mock_items")
    .select(
      "position, prompt, points, points_awarded, steps, exercise_id, problem_id, question_id",
    )
    .eq("mock_id", mockId);
  if (error) failed("Loading the mock exam's items", error);
  const questionIds = items.flatMap((item) => item.question_id ?? []);
  const [questions, kcs, sources] = await Promise.all([
    supabase.from("questions").select("id, answer_text").in("id", questionIds),
    supabase
      .from("question_kcs")
      .select("question_id, kc_id")
      .in("question_id", questionIds),
    Promise.all(items.map((item) => loadItemSource(supabase, courseId, item))),
  ]);
  if (questions.error)
    failed("Loading the mock exam's answers", questions.error);
  if (kcs.error) failed("Loading the mock exam's KCs", kcs.error);
  const reviewed = items.map((item, i) => {
    const answer = questions.data.find(
      ({ id }) => id === item.question_id,
    )?.answer_text;
    const steps = stepsSchema.safeParse(item.steps);
    return {
      position: item.position,
      awarded: item.points_awarded,
      points: item.points,
      item: {
        number: item.position + 1,
        prompt: item.prompt,
        answer: answer?.trim() ? answer : null,
        points: item.points,
        pointsAwarded: item.points_awarded,
        steps: steps.success ? steps.data : [],
        reference: sources[i]?.reference ?? null,
        kcs: kcs.data
          .filter(({ question_id }) => question_id === item.question_id)
          .map(({ kc_id }) => ({ id: kc_id, name: kcName(kc_id) })),
      },
    };
  });
  return byPointsLost(reviewed).map(({ item }) => item);
}

/**
 * The Course's graded questions the Student answered with confidence 4,
 * and how many were right: every attempt `full`. Null without one.
 */
export async function loadSureAnswers(
  supabase: Supabase,
  courseId: string,
): Promise<{ right: number; total: number } | null> {
  const { data, error } = await supabase
    .from("questions")
    .select("id, attempts(result), study_sessions!inner(course_id)")
    .eq("study_sessions.course_id", courseId)
    .eq("confidence", 4)
    .not("graded_at", "is", null);
  if (error) failed("Loading the sure answers", error);
  const graded = data.filter((question) => question.attempts.length > 0);
  if (graded.length === 0) return null;
  return {
    right: graded.filter((question) =>
      question.attempts.every(({ result }) => result === "full"),
    ).length,
    total: graded.length,
  };
}
