"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { briefPath } from "@/features/brief";
import { endSessionSchema, saveMemorySchema } from "@/features/study/schemas";
import { closeIdleSession, endSession } from "@/features/study/server/sessions";
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

/**
 * Ends the Study session of one of the Student's Chats now, for End session.
 * A session that ended already stays as it is, and one gone idle ends at its
 * newest message.
 */
export async function endStudySession(input: {
  chatId: string;
}): Promise<ActionResult> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(endSessionSchema, input);
  if (!parsed.ok) return parsed;

  const { chatId } = parsed.data;
  const supabase = await createClient();
  const now = new Date();
  if (await closeIdleSession(supabase, chatId, now)) {
    return { ok: true, data: undefined };
  }
  if (!(await endSession(supabase, chatId, now.toISOString()))) {
    return { ok: false, message: "This Chat has no study session to end." };
  }
  return { ok: true, data: undefined };
}
