import "server-only";
import { start } from "workflow/api";
import { gradeMock } from "@/features/study/workflows/grade-mock";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * Starts the grading of a submitted Mock exam (#186), whose start
 * `submit_mock_exam` or `restart_mock_grading` marked. A workflow that
 * cannot start is logged: the page starts it again an hour later.
 */
export async function startMockGrading(mockId: string): Promise<void> {
  try {
    await start(gradeMock, [mockId]);
  } catch (error) {
    console.error("Starting the mock exam's grading failed:", error);
  }
}

/**
 * Starts the grading of the signed-in Student's submitted mock again when
 * it never started or started over an hour ago (`restart_mock_grading`).
 */
export async function restartMockGrading(
  supabase: Supabase,
  mockId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("restart_mock_grading", {
    p_mock_id: mockId,
  });
  if (error) failed("Restarting the mock exam's grading", error);
  if (data) await startMockGrading(mockId);
}
