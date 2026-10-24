import "server-only";
import type { TopicChoice } from "@/features/study/domain/plan";
import { allRows } from "@/lib/supabase/all-rows";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The Student's pins and skips of a Course's Topics, read with `supabase`;
 * another Student's Course has none.
 */
export async function loadTopicChoices(
  supabase: Supabase,
  courseId: string,
): Promise<TopicChoice[]> {
  const rows = await allRows("Loading the topic choices", (from, to) =>
    supabase
      .from("topic_choices")
      .select("topic_id, choice, created_at, topics!inner(course_id)")
      .eq("topics.course_id", courseId)
      .order("topic_id")
      .range(from, to),
  );
  return rows.map((row) => ({
    topicId: row.topic_id,
    choice: row.choice === "pinned" ? "pinned" : "skipped",
    createdAt: row.created_at,
  }));
}
