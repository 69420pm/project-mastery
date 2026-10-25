import "server-only";
import { z } from "zod";
import { getExamFacts } from "@/features/brief/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  kcState,
  replayCourse,
  sessionEnd,
  utcDay,
  type AttemptHelp,
  type AttemptKind,
  type AttemptResult,
  type Goal,
  type KcSchedule,
  type ReplayAttempt,
} from "@/features/study/domain/replay";
import type { KcState } from "@/features/study/types";
import { getUser } from "@/lib/auth/user";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/** A Course's attempt as the replay and the map page read it, oldest first. */
export type CourseAttempt = ReplayAttempt & {
  /** The Exercise its question posed; null for the AI's own question. */
  exerciseId: string | null;
};

/** The Course's attempts, with which of their sessions have ended at `now`. */
type CourseEvidence = {
  attempts: CourseAttempt[];
  ended: (sessionId: string) => boolean;
};

/**
 * The Course's attempts read with `supabase`, oldest first, and which of
 * their Study sessions have ended at `now` (`sessionEnd`). Attempts belong
 * to a Course through their Study session. A session whose Chat is gone
 * counts as ended, since no message can reach it.
 */
export async function loadCourseAttempts(
  supabase: Supabase,
  courseId: string,
  now: Date,
): Promise<CourseEvidence> {
  const rows = await allRows("Loading the attempts", (from, to) =>
    supabase
      .from("attempts")
      .select(
        "kc_id, session_id, question_id, kind, result, help, created_at, questions!inner(exercise_id, confidence, asked_at, answered_at), study_sessions!inner(course_id, ended_at, chat_id)",
      )
      .eq("study_sessions.course_id", courseId)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  const sessions = new Map(
    rows.map((row) => [row.session_id, row.study_sessions]),
  );
  const openChats = [...sessions.values()].flatMap((session) =>
    session.ended_at === null && session.chat_id !== null
      ? [session.chat_id]
      : [],
  );
  const lastMessageAt = new Map<string, string>();
  if (openChats.length > 0) {
    const { data, error } = await supabase
      .from("chats")
      .select("id, last_message_at")
      .in("id", openChats);
    if (error) failed("Loading the Chats of the open sessions", error);
    for (const chat of data) lastMessageAt.set(chat.id, chat.last_message_at);
  }
  const ended = new Set(
    [...sessions].flatMap(([id, { ended_at, chat_id }]) => {
      const chatGone = chat_id === null || !lastMessageAt.has(chat_id);
      if (ended_at === null && chatGone) return [id];
      const newestMessageAt = chat_id ? lastMessageAt.get(chat_id) : null;
      const end = sessionEnd(
        { endedAt: ended_at, newestMessageAt: newestMessageAt ?? null },
        now,
      );
      return end === null ? [] : [id];
    }),
  );
  return {
    attempts: rows.map((row) => ({
      kcId: row.kc_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
      kind: row.kind as AttemptKind,
      result: row.result as AttemptResult,
      help: row.help as AttemptHelp,
      exerciseId: row.questions.exercise_id,
      questionId: row.question_id,
      confidence: row.questions.confidence,
      seconds: row.questions.answered_at
        ? (Date.parse(row.questions.answered_at) -
            Date.parse(row.questions.asked_at)) /
          1000
        : null,
    })),
    ended: (sessionId) => ended.has(sessionId),
  };
}

/**
 * Each taught KC's schedule by KC id at `now`, replayed from the Course's
 * attempts read with `supabase` (`replayCourse`). KCs without a non-`pre`
 * attempt are missing.
 */
export async function loadSchedules(
  supabase: Supabase,
  courseId: string,
  facts: {
    examDate: string | null;
    goal: Goal;
    priorities: Record<string, number>;
  },
  now: Date,
): Promise<Map<string, KcSchedule>> {
  const { attempts, ended } = await loadCourseAttempts(supabase, courseId, now);
  return replayCourse(attempts, { ...facts, ended, today: utcDay(now) });
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
 * The Exercise of the Student's most recently asked question in the Course
 * that has one (the last Problem); null with none.
 */
export async function loadLastProblemExercise(
  supabase: Supabase,
  courseId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("questions")
    .select("exercise_id, study_sessions!inner(course_id)")
    .eq("study_sessions.course_id", courseId)
    .not("exercise_id", "is", null)
    .order("asked_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) failed("Loading the last Problem", error);
  return data?.[0]?.exercise_id ?? null;
}

/**
 * The Exercise of the most recent question in the Course with an attempt on
 * one of `kcIds` graded `full` with help `none`; null with none.
 */
export async function loadLastUnassistedSuccess(
  supabase: Supabase,
  courseId: string,
  kcIds: string[],
): Promise<string | null> {
  const { data, error } = await supabase
    .from("attempts")
    .select(
      "created_at, questions!inner(exercise_id), study_sessions!inner(course_id)",
    )
    .eq("study_sessions.course_id", courseId)
    .in("kc_id", kcIds)
    .eq("result", "full")
    .eq("help", "none")
    .not("questions.exercise_id", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) failed("Loading the last unassisted success", error);
  return data?.[0]?.questions.exercise_id ?? null;
}

/**
 * The signed-in Student's KC states of a Course by KC id, replayed now with
 * the Brief's exam date and goal. Only taught KCs are listed: a missing KC
 * is new. An unknown or another Student's Course has none.
 */
export async function getKcStates(
  courseId: string,
): Promise<Record<string, KcState>> {
  if (!z.uuid().safeParse(courseId).success || !(await getUser())) return {};
  const supabase = await createClient();
  const [exam, priorities] = await Promise.all([
    getExamFacts(supabase, courseId),
    loadKcPriorities(supabase, courseId),
  ]);
  const now = new Date();
  const schedules = await loadSchedules(
    supabase,
    courseId,
    { examDate: exam.examDate, goal: exam.goal, priorities },
    now,
  );
  return Object.fromEntries(
    [...schedules].map(([kcId, schedule]) => [kcId, kcState(schedule, now)]),
  );
}
