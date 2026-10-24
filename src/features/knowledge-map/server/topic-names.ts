import "server-only";
import { z } from "zod";
import { allRows } from "@/lib/supabase/all-rows";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The names of the Course's Topics by id, for the breadcrumb. Empty before a
 * build stored Topics, and for another Student's Course (Row Level
 * Security).
 */
export async function getTopicNames(
  courseId: string,
): Promise<Array<{ id: string; name: string }>> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return [];
  const supabase = await createClient();
  const topics = await allRows("Loading the topic names", (from, to) =>
    supabase
      .from("topics")
      .select("id, name")
      .eq("course_id", courseId)
      .order("position")
      .range(from, to),
  );
  return topics.map(({ id, name }) => ({ id, name }));
}
