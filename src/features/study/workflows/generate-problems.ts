import { generateProblem } from "@/features/study/workflows/generate-steps";
import {
  finishRun,
  planProblems,
} from "@/features/study/workflows/stock-steps";

/**
 * Generates Problems for a Course whose run `queue_problem_run` has moved to
 * `running` (#183): plans the run's stock (a Topic's, or the review stock)
 * and queues it, then writes the Course's queued Problems one by one. A
 * reached Daily limit stops the run and leaves the rest queued for the next
 * one. The run is done in any case, so the next trigger starts a new one;
 * a deleted Course stops it quietly.
 */
export async function generateProblems(courseId: string): Promise<void> {
  "use workflow";
  try {
    const plan = await planProblems(courseId);
    if (!plan) return;
    for (const problemId of plan.problemIds) {
      if ((await generateProblem(problemId)) === "limited") break;
    }
  } catch (error) {
    console.error("Generating Problems failed:", error);
  }
  await finishRun(courseId);
}
