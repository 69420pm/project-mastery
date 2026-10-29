import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The steps of a Knowledge map update (`build-knowledge-map.ts`). Each runs on
 * the admin client, since no Student is signed in, and so scopes every query
 * to the Course itself.
 */

/** Marks the running build built. Does nothing when none runs any more. */
export async function markBuilt(courseId: string): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("knowledge_map_builds")
    .update({
      status: "built",
      failure_reason: null,
      finished_at: new Date().toISOString(),
    })
    .eq("course_id", courseId)
    .eq("status", "building");
  if (error) failed("Recording the built map", error);
}

/** Marks the running build failed with a reason for the Student. */
export async function failBuild(
  courseId: string,
  reason: string,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient()
    .from("knowledge_map_builds")
    .update({ status: "failed", failure_reason: reason })
    .eq("course_id", courseId)
    .eq("status", "building");
  if (error) failed("Recording the failed build", error);
}
