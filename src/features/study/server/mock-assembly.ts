import "server-only";
import { start } from "workflow/api";
import { assembleMock } from "@/features/study/workflows/assemble-mock";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The signed-in Student's open Mock exam of a Course, or a new one whose
 * assembly it starts (#185). A workflow that cannot start fails the new
 * mock, so the Student can assemble another. Null for an unknown or another
 * Student's Course.
 */
export async function queueMockAssembly(
  supabase: Supabase,
  courseId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("queue_mock_exam", {
    p_course_id: courseId,
  });
  if (error) failed("Queueing the mock exam", error);
  const mock = data[0];
  if (!mock) return null;
  if (mock.queued) {
    try {
      await start(assembleMock, [mock.mock_id]);
    } catch (startError) {
      console.error("Starting the mock exam's assembly failed:", startError);
      await supabase.rpc("release_mock_exam", { p_mock_id: mock.mock_id });
    }
  }
  return mock.mock_id;
}
