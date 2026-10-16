import "server-only";
import { z } from "zod";
import { getExamDate } from "@/features/brief/server";
import {
  kcState,
  replayLadder,
  utcDay,
  type AttemptHelp,
  type LadderPosition,
} from "@/features/study/domain/ladder";
import type { KcState } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/** What the Student showed on one problem or review question. */
export type AttemptRecord = {
  exerciseId?: string;
  help: AttemptHelp;
  kcs: Array<{ kcId: string; correct: boolean }>;
};

/**
 * Stores an attempt as the Student, one row per KC in one statement, so it
 * is all or nothing. The caller checks that the ids are the Course's; Row
 * Level Security refuses any that are not.
 */
export async function insertAttempts(
  supabase: Supabase,
  courseId: string,
  attempt: AttemptRecord,
): Promise<void> {
  const { error } = await supabase.from("attempts").insert(
    attempt.kcs.map(({ kcId, correct }) => ({
      course_id: courseId,
      kc_id: kcId,
      exercise_id: attempt.exerciseId ?? null,
      correct,
      help: attempt.help,
    })),
  );
  if (error) throw new Error(`Recording the attempt failed: ${error.message}`);
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
  const rows = await allRows("Loading the attempts", (from, to) => {
    const query = supabase
      .from("attempts")
      .select("kc_id, correct, help, created_at")
      .eq("course_id", courseId);
    return (kcIds ? query.in("kc_id", kcIds) : query)
      .order("created_at")
      .order("id")
      .range(from, to);
  });
  const byKc = Map.groupBy(rows, (row) => row.kc_id);
  return new Map(
    [...byKc].map(([kcId, attempts]) => [
      kcId,
      replayLadder(
        attempts.map((row) => ({
          createdAt: row.created_at,
          correct: row.correct,
          help: row.help as AttemptHelp,
        })),
        examDate,
      )!,
    ]),
  );
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
  const examDate = await getExamDate(supabase, courseId);
  const ladder = await loadLadder(supabase, courseId, examDate);
  const today = utcDay(new Date());
  return Object.fromEntries(
    [...ladder].map(([kcId, position]) => [
      kcId,
      { state: kcState(position, today), ...position },
    ]),
  );
}
