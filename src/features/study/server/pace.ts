import "server-only";
import {
  activeSeconds,
  measurePace,
  paceEvidence,
  type PaceMessage,
} from "@/features/study/domain/pace";
import type { Pace } from "@/features/study/domain/plan";
import { loadCourseAttempts } from "@/features/study/server/attempts";
import { allRows } from "@/lib/supabase/all-rows";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/** The newest teaching sessions whose active time is read. */
const SAMPLE = 5;

/**
 * The Student's measured pace in a Course at `now` (`measurePace`), read
 * with `supabase` from its attempts, their questions and the messages of
 * the newest 5 teaching sessions that still have their Chat. A session
 * whose Chat is gone has no known active time and doesn't count.
 */
export async function loadPace(
  supabase: Supabase,
  courseId: string,
  now: Date,
): Promise<Pace> {
  const { attempts, ended } = await loadCourseAttempts(supabase, courseId, now);
  const { reviews, teaching } = paceEvidence(attempts, ended);
  const active = new Map<string, number>();
  if (teaching.length > 0) {
    const { data, error } = await supabase
      .from("study_sessions")
      .select("id, chat_id")
      .in(
        "id",
        teaching.map((session) => session.sessionId),
      );
    if (error) failed("Loading the teaching sessions", error);
    const chatOf = new Map(data.map((row) => [row.id, row.chat_id]));
    const sampled = teaching
      .flatMap(({ sessionId }) => {
        const chatId = chatOf.get(sessionId);
        return chatId ? [{ sessionId, chatId }] : [];
      })
      .slice(-SAMPLE);
    if (sampled.length > 0) {
      const rows = await allRows("Loading the teaching messages", (from, to) =>
        supabase
          .from("chat_messages")
          .select("id, chat_id, role, created_at")
          .in(
            "chat_id",
            sampled.map((session) => session.chatId),
          )
          .order("created_at")
          .order("id")
          .range(from, to),
      );
      const byChat = Map.groupBy(rows, (row) => row.chat_id);
      for (const { sessionId, chatId } of sampled) {
        const messages: PaceMessage[] = (byChat.get(chatId) ?? []).map(
          (row) => ({
            role: row.role as PaceMessage["role"],
            createdAt: row.created_at,
          }),
        );
        active.set(sessionId, activeSeconds(messages));
      }
    }
  }
  return measurePace({
    reviews,
    teaching,
    active: (sessionId) => active.get(sessionId),
  });
}
