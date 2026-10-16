import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import { loadStoredMap } from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { utcDay } from "@/features/study/domain/ladder";
import { planStudy } from "@/features/study/domain/plan";
import { loadLadder } from "@/features/study/server/attempts";
import type { StudyPlan } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

const NO_PLAN: StudyPlan = {
  phase: null,
  share: null,
  leftOut: [],
  hoursPerWeek: null,
};

/**
 * The signed-in Student's study plan of a Course, derived today from its
 * map, Priorities, attempts and Brief. An unknown or another Student's
 * Course has none.
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
  const ladder = await loadLadder(supabase, courseId, exam.examDate);
  const { phase, pacing } = planStudy({
    kcs: map.kcs,
    priorities,
    taught: new Set(ladder.keys()),
    exam,
    today: utcDay(new Date()),
  });
  return {
    phase,
    share: pacing?.share ?? null,
    leftOut: pacing?.leftOut ?? [],
    hoursPerWeek: exam.hoursPerWeek,
  };
}
