import "server-only";
import {
  replayCourse,
  type AttemptHelp,
  type AttemptResult,
  type Goal,
  type KcRecall,
  type ReplayAttempt,
} from "@/features/study/domain/replay";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/** A Course's attempt as the replay and the map page read it, oldest first. */
export type CourseAttempt = ReplayAttempt & {
  /** The Exercise its question posed; null for the AI's own question. */
  exerciseId: string | null;
};

/**
 * The Course's attempts read with `supabase`, oldest first. Attempts belong
 * to a Course through their Study session.
 */
export async function loadCourseAttempts(
  supabase: Supabase,
  courseId: string,
): Promise<CourseAttempt[]> {
  const rows = await allRows("Loading the attempts", (from, to) =>
    supabase
      .from("attempts")
      .select(
        "kc_id, session_id, result, help, created_at, questions!inner(exercise_id, asked_at, answered_at), study_sessions!inner(course_id)",
      )
      .eq("study_sessions.course_id", courseId)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    kcId: row.kc_id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    result: row.result as AttemptResult,
    help: row.help as AttemptHelp,
    exerciseId: row.questions.exercise_id,
    seconds: row.questions.answered_at
      ? (Date.parse(row.questions.answered_at) -
          Date.parse(row.questions.asked_at)) /
        1000
      : null,
  }));
}

/**
 * Each taught KC's recall by KC id at `now`, replayed from the Course's
 * attempts read with `supabase` (`replayCourse`). Untaught KCs are missing.
 */
export async function loadRecall(
  supabase: Supabase,
  courseId: string,
  facts: { examDate: string | null; goal: Goal },
  now: Date,
): Promise<Map<string, KcRecall>> {
  const attempts = await loadCourseAttempts(supabase, courseId);
  return replayCourse(attempts, { ...facts, now });
}

/**
 * The columns of a question that name the Problem it poses: an Exercise, or
 * a generated Problem. Each is read with its own query, since a question
 * sets at most one.
 */
const PROBLEM_COLUMNS = ["exercise_id", "problem_id"] as const;

/** The Problem a question poses, from whichever column names it. */
const posed = (row: {
  exercise_id: string | null;
  problem_id: string | null;
}): string | null => row.exercise_id ?? row.problem_id;

/**
 * The Course's Exercises and generated Problems the Student has been asked
 * as a question, answered or not, each with when it was last asked (an ISO
 * timestamp), by id.
 */
export async function loadAskedProblems(
  supabase: Supabase,
  courseId: string,
): Promise<Map<string, string>> {
  const asked = await Promise.all(
    PROBLEM_COLUMNS.map((column) =>
      allRows("Loading the asked Problems", (from, to) =>
        supabase
          .from("questions")
          .select(
            "exercise_id, problem_id, asked_at, study_sessions!inner(course_id)",
          )
          .eq("study_sessions.course_id", courseId)
          .not(column, "is", null)
          .order("id")
          .range(from, to),
      ),
    ),
  );
  const lastAsked = new Map<string, string>();
  for (const row of asked.flat()) {
    const id = posed(row);
    if (id === null) continue;
    const before = lastAsked.get(id);
    if (before === undefined || row.asked_at > before) {
      lastAsked.set(id, row.asked_at);
    }
  }
  return lastAsked;
}

/**
 * The Exercise or generated Problem of the Student's most recently asked
 * question in the Course that poses one (the last Problem); null with none.
 */
export async function loadLastProblem(
  supabase: Supabase,
  courseId: string,
): Promise<string | null> {
  const latest = await Promise.all(
    PROBLEM_COLUMNS.map(async (column) => {
      const { data, error } = await supabase
        .from("questions")
        .select(
          "asked_at, exercise_id, problem_id, study_sessions!inner(course_id)",
        )
        .eq("study_sessions.course_id", courseId)
        .not(column, "is", null)
        .order("asked_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error) failed("Loading the last Problem", error);
      return data[0] ?? null;
    }),
  );
  const last = latest
    .filter((row) => row !== null)
    .toSorted((a, b) => b.asked_at.localeCompare(a.asked_at))[0];
  return last ? posed(last) : null;
}

/**
 * The Exercise or generated Problem of the most recent question in the
 * Course with an attempt on one of `kcIds` graded `full` with help `none`;
 * null with none.
 */
export async function loadLastUnassistedSuccess(
  supabase: Supabase,
  courseId: string,
  kcIds: string[],
): Promise<string | null> {
  const latest = await Promise.all(
    PROBLEM_COLUMNS.map(async (column) => {
      const { data, error } = await supabase
        .from("attempts")
        .select(
          "created_at, questions!inner(exercise_id, problem_id), study_sessions!inner(course_id)",
        )
        .eq("study_sessions.course_id", courseId)
        .in("kc_id", kcIds)
        .eq("result", "full")
        .eq("help", "none")
        .not(`questions.${column}`, "is", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error) failed("Loading the last unassisted success", error);
      return data[0] ?? null;
    }),
  );
  const last = latest
    .filter((row) => row !== null)
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return last ? posed(last.questions) : null;
}
