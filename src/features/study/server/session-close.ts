import "server-only";
import { start } from "workflow/api";
import { closeStudySession } from "@/features/study/workflows/close-study-session";

/**
 * Starts closing an ended Study session (#187). It never throws, so ending
 * a session cannot fail the Student's action or reply: a workflow that
 * cannot start is logged, and the session stays without notes.
 */
export async function startSessionClose(sessionId: string): Promise<void> {
  try {
    await start(closeStudySession, [sessionId]);
  } catch (error) {
    console.error("Starting the session's close failed:", error);
  }
}
