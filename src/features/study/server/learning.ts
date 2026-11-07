import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import type { MapKcLearning } from "@/features/knowledge-map";
import { kcBand } from "@/features/study/domain/recall-band";
import { desiredRetention, replayCourse } from "@/features/study/domain/replay";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/**
 * What the signed-in Student has learned of each KC of a Course, as the map
 * page shows it: its recall band, recall today and next review replayed
 * now, and its attempts newest first. Only KCs with attempts are listed. An
 * unknown or another Student's Course has none.
 */
export async function getKcLearning(courseId: string): Promise<MapKcLearning> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const now = new Date();
  const [exam, attempts] = await Promise.all([
    getExamFacts(supabase, courseId),
    loadCourseAttempts(supabase, courseId),
  ]);
  const recall = replayCourse(attempts, {
    examDate: exam.examDate,
    goal: exam.goal,
    now,
  });
  const retention = desiredRetention(exam.goal);
  const learning: MapKcLearning = {};
  for (const [kcId, kcAttempts] of Map.groupBy(attempts, (a) => a.kcId)) {
    learning[kcId] = {
      ...kcBand(recall.get(kcId), retention),
      attempts: kcAttempts.toReversed().map((attempt) => ({
        createdAt: attempt.createdAt,
        result: attempt.result,
        help: attempt.help,
        exerciseId: attempt.exerciseId,
      })),
    };
  }
  return learning;
}
