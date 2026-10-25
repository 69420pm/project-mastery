import "server-only";
import { start } from "workflow/api";
import { generateProblems } from "@/features/study/workflows/generate-problems";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Starts generating Problems for the signed-in Student's Course (#183):
 * the stock of a Topic whose Learn session just started, or the review
 * stock when `topicId` is null, after a Study session ended. A run already
 * running drops the call (`queue_problem_run`). It never throws, so a
 * trigger cannot fail the Student's reply or action: errors are logged, and
 * a run whose workflow cannot start is released.
 */
export async function queueProblemGeneration(
  supabase: Supabase,
  courseId: string,
  topicId: string | null,
): Promise<void> {
  try {
    const { data: queued, error } = await supabase.rpc("queue_problem_run", {
      p_course_id: courseId,
      ...(topicId !== null && { p_topic_id: topicId }),
    });
    if (error) throw new Error(error.message);
    if (!queued) return;
    try {
      await start(generateProblems, [courseId]);
    } catch (startError) {
      console.error("Starting the generate run failed:", startError);
      await supabase.rpc("release_problem_run", { p_course_id: courseId });
    }
  } catch (error) {
    console.error("Queueing the generate run failed:", error);
  }
}
