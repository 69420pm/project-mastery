import "server-only";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Stores the Student's grade of a Course's exam on a date, null when they
 * skip. False when the Course is not theirs; a date answered already stays
 * as it is.
 */
export async function recordExamResult(
  supabase: Supabase,
  result: { courseId: string; examDate: string; grade: string | null },
): Promise<boolean> {
  const { error } = await supabase.from("exam_results").insert({
    course_id: result.courseId,
    exam_date: result.examDate,
    grade: result.grade || null,
  });
  // Not the Student's Course, or answered already.
  if (error?.code === "42501") return false;
  if (error && error.code !== "23505") failed("Saving the exam result", error);
  return true;
}
