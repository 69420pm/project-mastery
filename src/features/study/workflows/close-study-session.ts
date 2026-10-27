import {
  claimSessionClose,
  storeSessionClose,
  writeSessionClose,
} from "@/features/study/workflows/close-steps";

/**
 * Closes an ended Study session (#187): claims it, writes its notes with
 * one `close` call and stores them. A duplicate start stops at the claim. A
 * session without a Chat or a Student message stays claimed with no notes,
 * and so does one whose call or store still fails after the step's retries.
 */
export async function closeStudySession(sessionId: string): Promise<void> {
  "use workflow";
  if (!(await claimSessionClose(sessionId))) return;
  const close = await writeSessionClose(sessionId);
  if (close) await storeSessionClose(sessionId, close);
}
