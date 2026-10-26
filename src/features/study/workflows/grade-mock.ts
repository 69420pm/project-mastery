import {
  failMockItem,
  finishMockGrading,
  gradeMockItem,
  loadUngradedItems,
} from "@/features/study/workflows/grade-steps";

/**
 * Grades a submitted Mock exam (#186), one step per item, and makes it
 * graded with its score and Brier score. An item still failing after its
 * step's retries is marked as not gradable and left out of both. Every step
 * is idempotent, so the mock page may start it again.
 */
export async function gradeMock(mockId: string): Promise<void> {
  "use workflow";
  const items = await loadUngradedItems(mockId);
  for (const itemId of items) {
    try {
      await gradeMockItem(itemId);
    } catch (error) {
      console.error("Grading a mock exam item failed:", error);
      await failMockItem(itemId);
    }
  }
  await finishMockGrading(mockId);
}
