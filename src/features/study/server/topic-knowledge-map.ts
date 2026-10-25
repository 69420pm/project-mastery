import "server-only";
import {
  getKnowledgeMap,
  loadCourseTopics,
  restrictMapToTopic,
} from "@/features/knowledge-map/server";
import { getPriorities } from "@/features/priorities/server";
import { getKcLearning } from "@/features/study/server/learning";
import type { TopicKnowledgeMap } from "@/features/study/types";

/**
 * The signed-in Student's view of a Topic's part of the Knowledge map, the
 * Topic's KCs and anchors (`restrictMapToTopic`) with their KC states; null
 * for a Topic not of the Course.
 */
export async function loadTopicKnowledgeMap(
  courseId: string,
  topicId: string,
): Promise<TopicKnowledgeMap | null> {
  const [map, topics, priorities, learning] = await Promise.all([
    getKnowledgeMap(courseId),
    loadCourseTopics(courseId),
    getPriorities(courseId),
    getKcLearning(courseId),
  ]);
  const topic = topics.find(({ id }) => id === topicId);
  if (!topic) return null;
  return {
    name: topic.name,
    map: restrictMapToTopic(map, topic),
    priorities,
    learning,
  };
}
