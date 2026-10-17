import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import type { MapKcLearning } from "@/features/knowledge-map";
import { loadStoredMap } from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import { selectCandidates } from "@/features/study/domain/candidates";
import {
  kcState,
  replayLadder,
  utcDay,
  type AttemptHelp,
} from "@/features/study/domain/ladder";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";

/**
 * What the signed-in Student has learned of each KC of a Course, as the map
 * page shows it: its state and place on the review ladder replayed today,
 * its attempts newest first, and whether it is among the AI's candidates
 * (`selectCandidates`) with its anchors. Only KCs with attempts or among the
 * candidates are listed. An unknown or another Student's Course has none.
 */
export async function getKcLearning(courseId: string): Promise<MapKcLearning> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const [map, priorities, exam, rows] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    getExamFacts(supabase, courseId),
    allRows("Loading the attempts", (from, to) =>
      supabase
        .from("attempts")
        .select("kc_id, exercise_id, correct, help, created_at")
        .eq("course_id", courseId)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  const today = utcDay(new Date());
  const learning: MapKcLearning = {};
  for (const [kcId, attempts] of Map.groupBy(rows, (row) => row.kc_id)) {
    const position = replayLadder(
      attempts.map((row) => ({
        createdAt: row.created_at,
        correct: row.correct,
        help: row.help as AttemptHelp,
      })),
      exam.examDate,
    )!;
    learning[kcId] = {
      state: kcState(position, today),
      ...position,
      attempts: attempts.toReversed().map((row) => ({
        createdAt: row.created_at,
        correct: row.correct,
        help: row.help as AttemptHelp,
        exerciseId: row.exercise_id,
      })),
      candidate: false,
      anchors: [],
    };
  }
  const candidates = selectCandidates(
    map,
    priorities,
    new Set(Object.keys(learning)),
  ).flatMap((group) => group.kcs);
  for (const candidate of candidates) {
    learning[candidate.id] = {
      state: "new",
      level: null,
      nextReview: null,
      attempts: [],
      candidate: true,
      anchors: candidate.anchors,
    };
  }
  return learning;
}
