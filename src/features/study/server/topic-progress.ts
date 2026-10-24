import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import type { MapTopicProgress } from "@/features/knowledge-map";
import { loadStoredTopics } from "@/features/knowledge-map/server";
import { desiredRetention } from "@/features/study/domain/replay";
import { topicProgress } from "@/features/study/domain/topic-progress";
import { loadSchedules } from "@/features/study/server/attempts";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in Student's Topic state and recall today for each stored Topic
 * of a Course, by Topic id (`topicProgress`), replayed now with the Brief's
 * exam date and goal. Empty before a build stored Topics; an unknown or
 * another Student's Course has none.
 */
export async function getTopicProgress(
  courseId: string,
): Promise<MapTopicProgress> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const [topics, exam] = await Promise.all([
    loadStoredTopics(supabase, courseId),
    getExamFacts(supabase, courseId),
  ]);
  if (topics.length === 0) return {};
  const now = new Date();
  // Priorities only order the final-week sweep, which moves due dates;
  // neither the state nor the recall reads them.
  const schedules = await loadSchedules(
    supabase,
    courseId,
    { examDate: exam.examDate, goal: exam.goal, priorities: {} },
    now,
  );
  const options = {
    now,
    examDate: exam.examDate,
    retention: desiredRetention(exam.goal),
  };
  return Object.fromEntries(
    topics.map((topic) => [
      topic.id,
      topicProgress(topic.kcs, schedules, options),
    ]),
  );
}
