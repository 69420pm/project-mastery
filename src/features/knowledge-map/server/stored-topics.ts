import "server-only";
import type { Topic } from "@/features/knowledge-map/domain/topics";
import { allRows } from "@/lib/supabase/all-rows";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The Course's stored Topics in Course order, each with its KCs in teaching
 * order; none before a build stored them. Reads on the admin client or a
 * Student's session client, where Row Level Security leaves another
 * Student's Course empty.
 */
export async function loadStoredTopics(
  supabase: Supabase,
  courseId: string,
): Promise<Array<Topic & { id: string }>> {
  const [topics, topicKcs] = await Promise.all([
    allRows("Loading the topics", (from, to) =>
      supabase
        .from("topics")
        .select("id, big_idea_id, name, central_question")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the topic KCs", (from, to) =>
      supabase
        .from("topic_kcs")
        .select("topic_id, kc_id, topics!inner(course_id)")
        .eq("topics.course_id", courseId)
        .order("topic_id")
        .order("position")
        .range(from, to),
    ),
  ]);
  return topics.map((topic) => ({
    id: topic.id,
    bigIdea: topic.big_idea_id,
    name: topic.name,
    centralQuestion: topic.central_question,
    kcs: topicKcs
      .filter((row) => row.topic_id === topic.id)
      .map((row) => row.kc_id),
  }));
}
