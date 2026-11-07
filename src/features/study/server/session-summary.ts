import "server-only";
import { getExamFacts } from "@/features/brief/server";
import { loadStoredMap } from "@/features/knowledge-map/server";
import { replayCourse } from "@/features/study/domain/replay";
import { sessionEnd } from "@/features/study/domain/session-end";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import type { AttemptResult, SessionSummary } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * What the close card shows of a Chat's Study session at `now`: each KC
 * checked in it with its latest result there and its next review. Null
 * without a session.
 */
export async function loadSessionSummary(
  supabase: Supabase,
  chatId: string,
  now: Date = new Date(),
): Promise<SessionSummary | null> {
  const [{ data: session, error }, chat] = await Promise.all([
    supabase
      .from("study_sessions")
      .select("id, course_id, ended_at, rating, rating_note")
      .eq("chat_id", chatId)
      .maybeSingle(),
    supabase
      .from("chats")
      .select("last_message_at")
      .eq("id", chatId)
      .maybeSingle(),
  ]);
  if (error) failed("Loading the Study session", error);
  if (chat.error) failed("Loading the Chat", chat.error);
  if (!session) return null;
  const courseId = session.course_id;
  const [exam, attempts, map] = await Promise.all([
    getExamFacts(supabase, courseId),
    loadCourseAttempts(supabase, courseId),
    loadStoredMap(supabase, courseId),
  ]);
  const recall = replayCourse(attempts, {
    examDate: exam.examDate,
    goal: exam.goal,
    now,
  });
  const kcName = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  // Each KC's latest result in the session, in the order first checked.
  const results = new Map<string, AttemptResult>();
  for (const attempt of attempts
    .filter(({ sessionId }) => sessionId === session.id)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    results.set(attempt.kcId, attempt.result);
  }
  return {
    kcs: [...results].map(([id, result]) => ({
      id,
      name: kcName.get(id) ?? id,
      result,
      nextReview: recall.get(id)?.nextReview ?? null,
    })),
    ended:
      sessionEnd(
        {
          endedAt: session.ended_at,
          newestMessageAt: chat.data?.last_message_at ?? null,
        },
        now,
      ) !== null,
    rating: session.rating,
    ratingNote: session.rating_note,
  };
}

/**
 * Saves the Student's rating of the Chat's Study session. False when the
 * Chat has no session of theirs.
 */
export async function saveRating(
  supabase: Supabase,
  chatId: string,
  rating: number,
  note: string | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("study_sessions")
    .update({ rating, rating_note: note })
    .eq("chat_id", chatId)
    .select("id");
  if (error) failed("Saving the session's rating", error);
  return data.length > 0;
}
