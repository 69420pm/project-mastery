"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { startMaterialParseSchema } from "@/features/ingestion/schemas";
import { startParse } from "@/features/ingestion/server/start-parse";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

/**
 * Parse and Retry: starts the parse of one of the Student's Materials when it
 * was never parsed, its parse failed, or its workflow could not start.
 * Anything else, such as a second press while the first one's parse waits,
 * does nothing, so it starts one parse. A retry resumes where the last parse
 * stopped.
 */
export async function startMaterialParse(input: {
  materialId: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(startMaterialParseSchema, input);
  if (!parsed.ok) return parsed;

  // The database moves it to `queued` only from those states, so of two
  // concurrent presses only one gets `true`.
  const supabase = await createClient();
  const { data: queued, error } = await supabase.rpc("queue_material_parse", {
    material_id: parsed.data.materialId,
  });
  if (error) throw new Error(`Queueing the parse failed: ${error.message}`);
  if (queued) {
    await startParse(supabase, parsed.data.materialId);
    revalidatePath("/", "layout");
  }
  return { ok: true, data: undefined };
}
