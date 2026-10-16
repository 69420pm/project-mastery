"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { briefPath } from "@/features/brief";
import { saveMemorySchema } from "@/features/study/schemas";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { parseActionInput, type ActionResult } from "@/lib/validation/action";

/**
 * Saves the Student's edit of a Course's Memory: replaces the whole text,
 * creating the row on the first save. Empty text clears the Memory. It
 * overwrites any line the AI added since the page loaded.
 */
export async function saveMemory(input: {
  courseId: string;
  text: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(saveMemorySchema, input);
  if (!parsed.ok) return parsed;

  const { courseId, text } = parsed.data;
  const { error } = await (
    await createClient()
  )
    .from("memories")
    .upsert({ course_id: courseId, text }, { onConflict: "course_id" });
  if (error?.code === "42501") {
    return { ok: false, message: "This Course was not found." };
  }
  if (error) throw new Error(`Saving the Memory failed: ${error.message}`);

  revalidatePath(briefPath(courseId));
  return { ok: true, data: undefined };
}
