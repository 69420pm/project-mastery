import "server-only";
import { start } from "workflow/api";
import { pairCourse } from "@/features/ingestion/workflows/pair-exercises";

/**
 * Starts pairing the exercises of one of the signed-in Student's Courses
 * again, after one of its Materials was deleted. When it cannot start, the
 * error is logged, not thrown: the delete itself has succeeded, and the
 * Course's next parse pairs it again.
 */
export async function startPairing(courseId: string): Promise<void> {
  try {
    await start(pairCourse, [courseId]);
  } catch (error) {
    console.error("Starting the pairing of a Course failed:", error);
  }
}
