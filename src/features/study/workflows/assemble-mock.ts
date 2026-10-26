import { generateProblem } from "@/features/study/workflows/generate-steps";
import {
  failMockExam,
  finishMockExam,
  planMockExam,
  setGapsDone,
} from "@/features/study/workflows/mock-steps";

/**
 * Assembles a Mock exam that `queue_mock_exam` inserted (#185): plans its
 * items, writes the Problem of each empty slot one by one through the
 * generate step, and makes it ready, or failed without items. A reached
 * Daily limit drops the slots not yet written. An error fails the mock, so
 * the Course can assemble another.
 */
export async function assembleMock(mockId: string): Promise<void> {
  "use workflow";
  try {
    const plan = await planMockExam(mockId);
    if (!plan) return;
    const generated: string[] = [];
    let done = 0;
    for (const item of plan.items) {
      if (!item.gap || item.problemId === null) continue;
      const outcome = await generateProblem(item.problemId);
      if (outcome === "limited") break;
      if (outcome === "ready") generated.push(item.problemId);
      done += 1;
      await setGapsDone(mockId, done);
    }
    await finishMockExam(mockId, plan, generated);
  } catch (error) {
    console.error("Assembling the mock exam failed:", error);
    await failMockExam(mockId, "Assembling the mock exam failed.");
  }
}
