import "server-only";
import type { loadStoredMap } from "@/features/knowledge-map/server";
import {
  replayCourse,
  utcDay,
  type Goal,
} from "@/features/study/domain/replay";
import {
  planReviewQueue,
  type ReviewGroup,
} from "@/features/study/domain/review-queue";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * A review session's queue (`planReviewQueue`), read with `supabase` on
 * every reply: the Course's schedules replayed without the session's
 * attempts at its start, and the session's questions and attempts for the
 * groups' statuses.
 */
export async function loadReviewQueue(
  supabase: Supabase,
  {
    courseId,
    session,
    map,
    topicOf,
    facts,
    minutesPerReview,
    now,
  }: {
    courseId: string;
    session: { id: string; startedAt: string };
    map: Awaited<ReturnType<typeof loadStoredMap>>;
    topicOf: ReadonlyMap<string, string>;
    facts: {
      examDate: string | null;
      goal: Goal;
      priorities: Record<string, number>;
    };
    minutesPerReview: number;
    now: Date;
  },
): Promise<ReviewGroup[]> {
  const [{ attempts, ended }, questions] = await Promise.all([
    loadCourseAttempts(supabase, courseId, now),
    supabase
      .from("questions")
      .select("asked_at, question_kcs(kc_id)")
      .eq("session_id", session.id),
  ]);
  if (questions.error)
    failed("Loading the session's questions", questions.error);
  const startedAt = new Date(session.startedAt);
  const schedules = replayCourse(
    attempts.filter(({ sessionId }) => sessionId !== session.id),
    { ...facts, ended, today: utcDay(startedAt) },
  );
  return planReviewQueue({
    kcs: map.kcs,
    schedules,
    priorities: facts.priorities,
    startedAt,
    minutesPerReview,
    topicOf,
    links: [...map.prerequisites, ...map.semanticLinks],
    questions: questions.data.map((row) => ({
      kcIds: row.question_kcs.map(({ kc_id }) => kc_id),
      askedAt: row.asked_at,
    })),
    attempts: attempts.filter(
      ({ sessionId, kind }) => sessionId === session.id && kind !== "pre",
    ),
  });
}
