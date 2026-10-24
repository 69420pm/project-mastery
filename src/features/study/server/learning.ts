import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import type { MapKcLearning } from "@/features/knowledge-map";
import { loadStoredMap } from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { selectCandidates } from "@/features/study/domain/candidates";
import { kcState, replayCourse, utcDay } from "@/features/study/domain/replay";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * What the signed-in Student has learned of each KC of a Course, as the map
 * page shows it: its state, next review and recall replayed now, its
 * attempts newest first, and whether it is among the AI's candidates
 * (`selectCandidates`) with its anchors. Only KCs with attempts or among the
 * candidates are listed. An unknown or another Student's Course has none.
 */
export async function getKcLearning(courseId: string): Promise<MapKcLearning> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const now = new Date();
  const [map, priorities, exam, { attempts, ended }] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    getExamFacts(supabase, courseId),
    loadCourseAttempts(supabase, courseId, now),
  ]);
  const schedules = replayCourse(attempts, {
    ended,
    examDate: exam.examDate,
    goal: exam.goal,
    priorities,
    today: utcDay(now),
  });
  const learning: MapKcLearning = {};
  for (const [kcId, kcAttempts] of Map.groupBy(attempts, (a) => a.kcId)) {
    learning[kcId] = {
      ...kcState(schedules.get(kcId), now),
      attempts: kcAttempts.toReversed().map((attempt) => ({
        createdAt: attempt.createdAt,
        result: attempt.result,
        help: attempt.help,
        exerciseId: attempt.exerciseId,
      })),
      candidate: false,
      anchors: [],
    };
  }
  const candidates = selectCandidates(
    map,
    priorities,
    new Set(schedules.keys()),
  ).flatMap((group) => group.kcs);
  for (const candidate of candidates) {
    // A KC with only prequestion attempts is still new, and can be one.
    learning[candidate.id] = {
      state: "new",
      nextReview: null,
      retrievability: null,
      attempts: learning[candidate.id]?.attempts ?? [],
      candidate: true,
      anchors: candidate.anchors,
    };
  }
  return learning;
}
