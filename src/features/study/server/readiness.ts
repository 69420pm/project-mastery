import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { readiness } from "@/features/study/domain/readiness";
import { loadSchedules } from "@/features/study/server/attempts";
import type { CourseReadiness } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";

const NONE: CourseReadiness = {
  course: null,
  topics: {},
  mocks: 0,
  onTheDay: false,
};

/**
 * The signed-in Student's Readiness of a Course now (`readiness`), per Topic
 * and overall, with how many graded mocks check it. An unknown or another
 * Student's Course has none.
 */
export async function getReadiness(courseId: string): Promise<CourseReadiness> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return NONE;
  const supabase = await createClient();
  const [map, topics, priorities, exam, graded] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadStoredTopics(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    getExamFacts(supabase, courseId),
    supabase
      .from("mock_exams")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("status", "graded"),
  ]);
  if (graded.error) failed("Counting the graded mocks", graded.error);
  const now = new Date();
  const schedules = await loadSchedules(
    supabase,
    courseId,
    { examDate: exam.examDate, goal: exam.goal, priorities },
    now,
  );
  const options = { now, examDate: exam.examDate };
  const kcs = map.kcs.map((kc) => ({ id: kc.id }));
  const byId = new Map(kcs.map((kc) => [kc.id, kc]));
  const topicValues = topics.flatMap((topic) => {
    const value = readiness(
      topic.kcs.flatMap((id) => byId.get(id) ?? []),
      priorities,
      schedules,
      options,
    );
    return value === null ? [] : [[topic.id, value] as const];
  });
  return {
    course: readiness(kcs, priorities, schedules, options),
    topics: Object.fromEntries(topicValues),
    mocks: graded.count ?? 0,
    onTheDay:
      exam.examDate !== null && exam.examDate > now.toISOString().slice(0, 10),
  };
}
