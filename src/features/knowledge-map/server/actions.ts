"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { startKnowledgeMapBuildSchema } from "@/features/knowledge-map/schemas";
import { startBuild } from "@/features/knowledge-map/server/start-build";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

/**
 * Build and Rebuild: starts a build of the Student's Course's Knowledge map
 * when none runs, a Material is parsed and none waits or parses. Anything
 * else, such as a second press while the first one's build runs, does
 * nothing, so it starts one build.
 */
export async function startKnowledgeMapBuild(input: {
  courseId: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(startKnowledgeMapBuildSchema, input);
  if (!parsed.ok) return parsed;

  // A conditional upsert: of two concurrent presses only one gets `true`.
  const supabase = await createClient();
  const { data: queued, error } = await supabase.rpc(
    "queue_knowledge_map_build",
    { course_id: parsed.data.courseId },
  );
  if (error) throw new Error(`Queueing the build failed: ${error.message}`);
  if (queued) {
    await startBuild(supabase, parsed.data.courseId);
    revalidatePath("/", "layout");
  }
  return { ok: true, data: undefined };
}
