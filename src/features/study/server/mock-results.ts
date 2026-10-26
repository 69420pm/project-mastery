import "server-only";
import { z } from "zod";
import type { GradedStep } from "@/features/study/domain/mock-grading";
import type { MockTaskGrade } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * What a graded Mock exam's page reads besides the mock (#186): each
 * task's grade and the Student's calibration on sure answers.
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
