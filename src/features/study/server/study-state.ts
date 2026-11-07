import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { mockResultShares } from "@/features/study/domain/mock-grading";
import {
  DEFAULT_PACE,
  planProgress,
  planScope,
} from "@/features/study/domain/plan";
import { inFinalStretch, rankNext } from "@/features/study/domain/ranking";
import { readiness } from "@/features/study/domain/readiness";
import { replayCourse, utcDay } from "@/features/study/domain/replay";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import { loadTopicChoices } from "@/features/study/server/choices";
import { loadPace } from "@/features/study/server/pace";
import type { NextItem, StudyState } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

const NO_STATE: StudyState = {
  hasMap: false,
  hasTopics: false,
  examDate: null,
  finalStretch: false,
  ranking: [],
  scope: [],
  topics: {},
  progress: { learned: 0, total: 0, daysIn: null, daysLeft: null },
  readiness: { course: null, onTheDay: false },
  lastMockPercent: null,
  taught: false,
  pace: DEFAULT_PACE,
};

/**
 * The signed-in Student's study state of a Course, derived now from its
 * map, Topics, Priorities, Attempts, Brief, pins and skips and graded
 * mocks: the ranking (`rankNext`), the plan scope, Progress, Readiness per
 * Topic and Course, and the latest mock score. An unknown or another
 * Student's Course has none.
 */
export async function getStudyState(courseId: string): Promise<StudyState> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) {
    return NO_STATE;
  }
  const supabase = await createClient();
  const [map, priorities, exam, topics, attempts, choices, pace, lastMock] =
    await Promise.all([
      loadStoredMap(supabase, courseId),
      loadKcPriorities(supabase, courseId),
      getExamFacts(supabase, courseId),
      loadStoredTopics(supabase, courseId),
      loadCourseAttempts(supabase, courseId),
      loadTopicChoices(supabase, courseId),
      loadPace(supabase, courseId),
      loadLastMockPercent(supabase, courseId),
    ]);
  const now = new Date();
  const { examDate } = exam;
  const recall = replayCourse(attempts, { ...exam, now });
  const scope = planScope({ topics, priorities, goal: exam.goal, choices });
  const ranked = rankNext({
    topics,
    prerequisites: map.prerequisites,
    priorities,
    recall,
    pace,
    scope,
    examDate,
    now,
  });
  const kcName = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const ranking = ranked.map((item): NextItem => {
    if (item.kind === "topic") {
      const topic = topicById.get(item.topicId)!;
      return {
        kind: "topic",
        id: topic.id,
        name: topic.name,
        centralQuestion: topic.centralQuestion,
        minutes: item.minutes,
      };
    }
    return {
      kind: item.kind,
      id: item.kcId,
      name: kcName.get(item.kcId) ?? item.kcId,
      centralQuestion: null,
      minutes: item.minutes,
    };
  });
  const live = map.kcs.map((kc) => ({ id: kc.id }));
  return {
    hasMap: map.kcs.length > 0,
    hasTopics: topics.length > 0,
    examDate,
    finalStretch: inFinalStretch(examDate, now),
    ranking,
    scope,
    topics: Object.fromEntries(
      topics.map((topic) => [
        topic.id,
        {
          learned: topic.kcs.filter((id) => recall.get(id)?.learned).length,
          total: topic.kcs.length,
          readiness: readiness(
            topic.kcs.map((id) => ({ id })),
            priorities,
            recall,
          ),
        },
      ]),
    ),
    progress: planProgress({
      topics,
      scope,
      recall,
      examDate,
      firstAttemptAt: attempts[0]?.createdAt ?? null,
      now,
    }),
    readiness: {
      course: readiness(live, priorities, recall),
      onTheDay: examDate !== null && examDate > utcDay(now),
    },
    lastMockPercent: lastMock,
    taught: live.some(({ id }) => recall.get(id)?.taught),
    pace,
  };
}

/**
 * The score of the Course's latest graded Mock exam, 0 to 100, over the
 * items grading did not fail, read with `supabase`; null without one.
 */
async function loadLastMockPercent(
  supabase: Supabase,
  courseId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("mock_exams")
    .select("mock_items(points, points_awarded)")
    .eq("course_id", courseId)
    .eq("status", "graded")
    .order("graded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) failed("Loading the latest graded mock", error);
  if (!data) return null;
  return mockResultShares(
    data.mock_items.map((item) => ({
      points: item.points,
      awarded: item.points_awarded,
      predictedSuccess: 0,
      topic: null,
    })),
  ).scorePercent;
}
