import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import type { MapTopicStates } from "@/features/knowledge-map";
import { loadStoredTopics } from "@/features/knowledge-map/server";
import { desiredRetention } from "@/features/study/domain/replay";
import { topicState } from "@/features/study/domain/topic-state";
import { loadRecall } from "@/features/study/server/attempts";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Topic state and recall today for each stored Topic
 * of a Course, by Topic id (`topicState`), replayed now with the Brief's
 * exam date and goal. Empty before a build stored Topics; an unknown or
 * another Student's Course has none.
 */
export async function getTopicStates(
  courseId: string,
): Promise<MapTopicStates> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const [topics, exam] = await Promise.all([
    loadStoredTopics(supabase, courseId),
    getExamFacts(supabase, courseId),
  ]);
  if (topics.length === 0) return {};
  const recall = await loadRecall(supabase, courseId, exam, new Date());
  const retention = desiredRetention(exam.goal);
  return Object.fromEntries(
    topics.map((topic) => [topic.id, topicState(topic.kcs, recall, retention)]),
  );
}
