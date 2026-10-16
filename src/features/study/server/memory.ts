import "server-only";
import { z } from "zod";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Memory of a Course: what the AI noted to tutor
 * them. Empty when there is none, the id is malformed or the Course is
 * unknown or another Student's.
 */
export async function getMemory(courseId: string): Promise<string> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return "";
  const { data, error } = await (
    await createClient()
  )
    .from("memories")
    .select("text")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw new Error(`Reading the Memory failed: ${error.message}`);
  return data?.text ?? "";
}
