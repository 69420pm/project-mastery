import "server-only";
import { getExamFacts } from "@/features/brief/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import { loadKcPriorities } from "@/features/priorities/server";
import {
  desiredRetention,
  kcState,
  replayCourse,
  sessionEnd,
  utcDay,
} from "@/features/study/domain/replay";
import { topicState } from "@/features/study/domain/topic-state";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import type { SessionSummary } from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * What the close card shows of a Chat's Study session at `now`, computed as
 * if the session had ended: its Topic's new state, and each KC with
 * attempts in it with its state and next review. Null without a session.
 */
export async function loadSessionSummary(
  supabase: Supabase,
  chatId: string,
  now: Date = new Date(),
): Promise<SessionSummary | null> {
  const [{ data: session, error }, chat] = await Promise.all([
    supabase
      .from("study_sessions")
      .select("id, course_id, topic_id, ended_at, rating, rating_note")
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
  const [exam, priorities, evidence, map, topics] = await Promise.all([
    getExamFacts(supabase, courseId),
    loadKcPriorities(supabase, courseId),
    loadCourseAttempts(supabase, courseId, now),
    loadStoredMap(supabase, courseId),
    loadStoredTopics(supabase, courseId),
  ]);
  const schedules = replayCourse(evidence.attempts, {
    ended: (id) => id === session.id || evidence.ended(id),
    examDate: exam.examDate,
    goal: exam.goal,
    priorities,
    today: utcDay(now),
  });
  const kcName = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  const practised = new Set(
    evidence.attempts
      .filter((attempt) => attempt.sessionId === session.id)
      .map((attempt) => attempt.kcId),
  );
  const topic = topics.find(({ id }) => id === session.topic_id);
  return {
    topic: topic
      ? {
          name: topic.name,
          ...topicState(topic.kcs, schedules, {
            now,
            examDate: exam.examDate,
            retention: desiredRetention(exam.goal),
          }),
        }
      : null,
    kcs: [...practised].map((id) => {
      const { state, nextReview } = kcState(schedules.get(id), now);
      return { id, name: kcName.get(id) ?? id, state, nextReview };
    }),
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
