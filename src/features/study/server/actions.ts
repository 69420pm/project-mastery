"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { briefPath } from "@/features/brief";
import {
  endSessionSchema,
  saveMemorySchema,
  setTopicChoiceSchema,
} from "@/features/study/schemas";
import { appendMemory } from "@/features/study/server/memory";
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

/**
 * Pins or skips a Topic of the Student's Course, or clears the choice with
 * null. A new choice replaces the old one. A skip's reason goes to the
 * Memory as "Skipped <Topic>: <reason>"; `reasonKept` is false when the
 * Memory is full, and the skip is saved anyway.
 */
export async function setTopicChoice(input: {
  courseId: string;
  topicId: string;
  choice: "pinned" | "skipped" | null;
  reason?: string;
}): Promise<ActionResult<{ reasonKept: boolean }>> {
  if (!(await getUser())) {
    return { ok: false, message: "Sign in again to continue." };
  }
  const parsed = parseActionInput(setTopicChoiceSchema, input);
  if (!parsed.ok) return parsed;

  const { courseId, topicId, choice, reason } = parsed.data;
  const supabase = await createClient();
  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .select("name")
    .eq("id", topicId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (topicError) {
    throw new Error(`Reading the Topic failed: ${topicError.message}`);
  }
  if (!topic) return { ok: false, message: "This Topic was not found." };

  const { error } =
    choice === null
      ? await supabase.from("topic_choices").delete().eq("topic_id", topicId)
      : await supabase.from("topic_choices").upsert(
          {
            topic_id: topicId,
            choice,
            created_at: new Date().toISOString(),
          },
          { onConflict: "owner,topic_id" },
        );
  if (error) throw new Error(`Saving the choice failed: ${error.message}`);

  let reasonKept = true;
  if (choice === "skipped" && reason) {
    reasonKept = await appendMemory(
      supabase,
      courseId,
      `Skipped ${topic.name}: ${reason}`,
    );
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { reasonKept } };
}
