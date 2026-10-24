import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import {
  kcState,
  replayLadder,
  utcDay,
  type AttemptHelp,
  type AttemptResult,
  type LadderPosition,
} from "@/features/study/domain/ladder";
import type { KcState } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/** A Course's attempt as the ladder and the map page read it, oldest first. */
export type CourseAttempt = {
  kcId: string;
  /** An ISO timestamp. */
  createdAt: string;
  result: AttemptResult;
  help: AttemptHelp;
  /** The Exercise its question posed; null for the AI's own question. */
  exerciseId: string | null;
};

/**
 * The Course's attempts read with `supabase`, oldest first; only on `kcIds`
 * when given. Attempts belong to a Course through their Study session.
 */
export async function loadCourseAttempts(
  supabase: Supabase,
  courseId: string,
  kcIds?: string[],
): Promise<CourseAttempt[]> {
  const rows = await allRows("Loading the attempts", (from, to) => {
    const query = supabase
      .from("attempts")
      .select(
        "kc_id, result, help, created_at, questions!inner(exercise_id), study_sessions!inner(course_id)",
      )
      .eq("study_sessions.course_id", courseId);
    return (kcIds ? query.in("kc_id", kcIds) : query)
      .order("created_at")
      .order("id")
      .range(from, to);
  });
  return rows.map((row) => ({
    kcId: row.kc_id,
    createdAt: row.created_at,
    result: row.result as AttemptResult,
    help: row.help as AttemptHelp,
    exerciseId: row.questions.exercise_id,
  }));
}

/**
 * Each taught KC's place on the ladder by KC id, replayed from the Course's
 * attempts read with `supabase`; only `kcIds` when given. KCs without
 * attempts are missing.
 */
export async function loadLadder(
  supabase: Supabase,
  courseId: string,
  examDate: string | null,
  kcIds?: string[],
): Promise<Map<string, LadderPosition>> {
  const attempts = await loadCourseAttempts(supabase, courseId, kcIds);
  return new Map(
    [...Map.groupBy(attempts, (attempt) => attempt.kcId)].map(
      ([kcId, kcAttempts]) => [kcId, replayLadder(kcAttempts, examDate)!],
    ),
  );
}

/**
 * The ids of the Course's Exercises the Student has been asked as a
 * question, answered or not.
 */
export async function loadAttemptedExercises(
  supabase: Supabase,
  courseId: string,
): Promise<Set<string>> {
  const rows = await allRows("Loading the asked Exercises", (from, to) =>
    supabase
      .from("questions")
      .select("exercise_id, study_sessions!inner(course_id)")
      .eq("study_sessions.course_id", courseId)
      .not("exercise_id", "is", null)
      .order("id")
      .range(from, to),
  );
  return new Set(rows.flatMap(({ exercise_id }) => exercise_id ?? []));
}

/**
 * The signed-in Student's KC states of a Course by KC id, replayed today
 * with the Brief's exam date. Only KCs with attempts are listed: a missing
 * KC is new. An unknown or another Student's Course has none.
 */
export async function getKcStates(
  courseId: string,
): Promise<Record<string, KcState>> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const { examDate } = await getExamFacts(supabase, courseId);
  const ladder = await loadLadder(supabase, courseId, examDate);
  const today = utcDay(new Date());
  return Object.fromEntries(
    [...ladder].map(([kcId, position]) => [
      kcId,
      { state: kcState(position, today), ...position },
    ]),
  );
}
