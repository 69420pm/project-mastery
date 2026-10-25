import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  DEFAULT_PACE,
  type Pace,
  type Plan,
  planStudy,
} from "@/features/study/domain/plan";
import type { KcSchedule } from "@/features/study/domain/replay";
import { selectDueReviews } from "@/features/study/domain/reviews";
import { planToday, type TodayPlan } from "@/features/study/domain/today";
import { loadSchedules } from "@/features/study/server/attempts";
import { loadTopicChoices } from "@/features/study/server/choices";
import { loadPace } from "@/features/study/server/pace";
import type { StudyPlan } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

const NO_PLAN: StudyPlan = {
  phase: null,
  topics: [],
  order: [],
  fit: null,
  hoursPerWeek: null,
  pace: DEFAULT_PACE,
  hasMap: false,
  today: { reviews: null, next: null, hint: null },
};

/**
 * A Course's plan over its stored Topics (`planStudy`) at the Student's
 * measured pace (`loadPace`), read with `supabase`, from what the caller
 * already loaded and the Student's pins and skips, with the pace it used and
 * today's work (`planToday`).
 */
export async function loadPlan(
  supabase: Supabase,
  courseId: string,
  loaded: {
    prerequisites: Array<{ from: string; to: string }>;
    priorities: Record<string, number>;
    exam: Awaited<ReturnType<typeof getExamFacts>>;
    schedules: Map<string, KcSchedule>;
    /** How many KCs of the map are due. */
    dueCount: number;
    /** The stored Topics, when the caller has them; read otherwise. */
    topics?: Awaited<ReturnType<typeof loadStoredTopics>>;
  },
  now: Date,
): Promise<Plan & { pace: Pace; today: TodayPlan }> {
  const [topics, pace, choices] = await Promise.all([
    loaded.topics ?? loadStoredTopics(supabase, courseId),
    loadPace(supabase, courseId, now),
    loadTopicChoices(supabase, courseId),
  ]);
  const plan = {
    ...planStudy({ ...loaded, topics, choices, pace, now }),
    pace,
  };
  const today = planToday(plan, {
    topics,
    schedules: loaded.schedules,
    dueCount: loaded.dueCount,
    examDate: loaded.exam.examDate,
    now,
  });
  return { ...plan, today };
}

/** How many KCs of a map are due at `now`. */
function countDue(...args: Parameters<typeof selectDueReviews>): number {
  const { kcs, more } = selectDueReviews(...args);
  return kcs.length + more;
}

/**
 * The signed-in Student's study plan of a Course with today's work, derived
 * now from its Topics, map, Priorities, attempts and Brief. An unknown or
 * another Student's Course has none.
 */
export async function getPlan(courseId: string): Promise<StudyPlan> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) {
    return NO_PLAN;
  }
  const supabase = await createClient();
  const [map, priorities, exam] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    getExamFacts(supabase, courseId),
  ]);
  const now = new Date();
  const schedules = await loadSchedules(
    supabase,
    courseId,
    { examDate: exam.examDate, goal: exam.goal, priorities },
    now,
  );
  const plan = await loadPlan(
    supabase,
    courseId,
    {
      prerequisites: map.prerequisites,
      priorities,
      exam,
      schedules,
      dueCount: countDue(map.kcs, schedules, priorities, now),
    },
    now,
  );
  return {
    ...plan,
    hoursPerWeek: exam.hoursPerWeek,
    hasMap: map.kcs.length > 0,
  };
}
