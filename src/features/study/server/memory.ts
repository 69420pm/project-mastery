import "server-only";
import { z } from "zod";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The signed-in Student's Memory of a Course: what the AI noted to tutor
 * them. Empty when there is none, the id is malformed or the Course is
 * unknown or another Student's.
 */
export async function getMemory(courseId: string): Promise<string> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return "";
  return loadMemory(await createClient(), courseId);
}

/** A Course's Memory read with `supabase`; empty before the first write. */
export async function loadMemory(
  supabase: Supabase,
  courseId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("memories")
    .select("text")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw new Error(`Reading the Memory failed: ${error.message}`);
  return data?.text ?? "";
}

/**
 * Appends a dated line to a Course's Memory with `supabase` (#107).
 * Returns false, changing nothing, when the Memory would be too long.
 */
export async function appendMemory(
  supabase: Supabase,
  courseId: string,
  text: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("append_memory", {
    course_id: courseId,
    text,
  });
  if (error) throw new Error(`Saving to the Memory failed: ${error.message}`);
  return data === true;
}
