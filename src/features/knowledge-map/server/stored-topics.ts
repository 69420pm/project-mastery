import "server-only";
import type { Topic } from "@/features/knowledge-map/domain/topics";
import { allRows } from "@/lib/supabase/all-rows";
import type { Supabase } from "@/lib/supabase/types";

/** A stored Topic of the tree; one without KCs of its own has no question. */
export type TreeTopic = {
  id: string;
  parentId: string | null;
  name: string;
  centralQuestion: string | null;
  /** Its own KCs, in teaching order. */
  kcs: string[];
};

/**
 * The Course's whole Topic tree in tree order (a parent before its
 * children), each Topic with its own KCs in teaching order; none before a
 * build stored them. Reads on the admin client or a Student's session
 * client, where Row Level Security leaves another Student's Course empty.
 */
export async function loadTopicTree(
  supabase: Supabase,
  courseId: string,
): Promise<TreeTopic[]> {
  const [topics, topicKcs] = await Promise.all([
    allRows("Loading the topics", (from, to) =>
      supabase
        .from("topics")
        .select("id, parent_id, name, central_question")
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
    parentId: topic.parent_id,
    name: topic.name,
    centralQuestion: topic.central_question,
    kcs: topicKcs
      .filter((row) => row.topic_id === topic.id)
      .map((row) => row.kc_id),
  }));
}

/**
 * The Topics with KCs of their own, which the study plan, the Today card
 * and sessions use, in tree order (a parent before its children).
 */
function studyTopics(tree: TreeTopic[]): Array<Topic & { id: string }> {
  return tree.flatMap((topic) =>
    topic.kcs.length > 0 && topic.centralQuestion !== null
      ? [{ ...topic, centralQuestion: topic.centralQuestion }]
      : [],
  );
}

/**
 * The Course's Topics with KCs of their own in tree order (`studyTopics`),
 * each with its KCs in teaching order.
 */
export async function loadStoredTopics(
  supabase: Supabase,
  courseId: string,
): Promise<Array<Topic & { id: string }>> {
  return studyTopics(await loadTopicTree(supabase, courseId));
}
