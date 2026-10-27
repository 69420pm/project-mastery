import "server-only";
import { parseSessionMode } from "@/features/study/domain/modes";
import { topicAnchors } from "@/features/knowledge-map/server";
import {
  SESSION_NOTES_READ,
  topicNoteIds,
} from "@/features/study/domain/notes";
import type {
  SessionNoteEntry,
  TopicNoteEntry,
  TutorContext,
} from "@/features/study/types";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The notes the tutor reads on a reply: the Session notes of the Course, and
 * in a learn session with a Topic, the Topic notes. Topic notes are absent
 * without a Topic.
 */
export async function loadTutorNotes(
  supabase: Supabase,
  {
    courseId,
    sessionId,
    topic,
    topics,
    map,
  }: {
    courseId: string;
    sessionId: string | null;
    topic: { id: string; kcs: readonly string[] } | null;
    topics: ReadonlyArray<{ id: string; name: string; kcs: readonly string[] }>;
    map: Parameters<typeof topicAnchors>[1];
  },
): Promise<Pick<TutorContext, "sessionNotes" | "topicNotes">> {
  const [sessionNotes, topicNotes] = await Promise.all([
    loadSessionNotes(supabase, courseId, sessionId),
    topic
      ? loadTopicNotes(
          supabase,
          topicNoteIds(
            topic.id,
            topics,
            topicAnchors(topic.kcs, map).map(({ id }) => id),
          ).flatMap((id) => topics.filter((t) => t.id === id)),
        )
      : undefined,
  ]);
  return { sessionNotes, ...(topicNotes && { topicNotes }) };
}

/**
 * The Course's newest Session notes of other sessions, by `ended_at`, as the
 * tutor reads them (#187). `exceptSessionId` is the running session.
 */
export async function loadSessionNotes(
  supabase: Supabase,
  courseId: string,
  exceptSessionId: string | null,
): Promise<SessionNoteEntry[]> {
  // One more than needed: the running session may be among them.
  const { data, error } = await supabase
    .from("study_sessions")
    .select("id, session_note, mode, ended_at")
    .eq("course_id", courseId)
    .not("session_note", "is", null)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(SESSION_NOTES_READ + 1);
  if (error) failed("Loading the Session notes", error);
  return data
    .filter((row) => row.id !== exceptSessionId)
    .slice(0, SESSION_NOTES_READ)
    .flatMap((row) =>
      row.session_note && row.ended_at
        ? [
            {
              date: row.ended_at.slice(0, 10),
              mode: parseSessionMode(row.mode),
              text: row.session_note,
            },
          ]
        : [],
    );
}

/**
 * The Topic notes of the given Topics, in their order; Topics without a note
 * are left out.
 */
export async function loadTopicNotes(
  supabase: Supabase,
  topics: ReadonlyArray<{ id: string; name: string }>,
): Promise<TopicNoteEntry[]> {
  if (topics.length === 0) return [];
  const { data, error } = await supabase
    .from("topic_notes")
    .select("topic_id, text")
    .in(
      "topic_id",
      topics.map(({ id }) => id),
    );
  if (error) failed("Loading the Topic notes", error);
  const text = new Map(data.map((row) => [row.topic_id, row.text]));
  return topics.flatMap(({ id, name }) => {
    const note = text.get(id);
    return note ? [{ topic: name, text: note }] : [];
  });
}
