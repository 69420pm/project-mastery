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
import { loadSchedules } from "@/features/study/server/attempts";
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
};

/**
 * A Course's plan over its stored Topics (`planStudy`) at the Student's
 * measured pace (`loadPace`), read with `supabase`, from what the caller
 * already loaded, with the pace it used. No Topic is pinned or skipped yet.
 */
export async function loadPlan(
  supabase: Supabase,
  courseId: string,
  loaded: {
    prerequisites: Array<{ from: string; to: string }>;
    priorities: Record<string, number>;
    exam: Awaited<ReturnType<typeof getExamFacts>>;
    schedules: Map<string, KcSchedule>;
  },
  now: Date,
): Promise<Plan & { pace: Pace }> {
  const [topics, pace] = await Promise.all([
    loadStoredTopics(supabase, courseId),
    loadPace(supabase, courseId, now),
  ]);
  const plan = planStudy({ ...loaded, topics, choices: [], pace, now });
  return { ...plan, pace };
}

/**
 * The signed-in Student's study plan of a Course, derived now from its
 * Topics, map, Priorities, attempts and Brief. An unknown or another
 * Student's Course has none.
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
    { prerequisites: map.prerequisites, priorities, exam, schedules },
    now,
  );
  return { ...plan, hoursPerWeek: exam.hoursPerWeek };
}
