import "server-only";
import { closeCall } from "@/features/study/ai/close-call";
import {
  buildCloseInput,
  guardedNotes,
  type CloseNotes,
  type CloseSource,
} from "@/features/study/domain/close";
import { meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The steps of `closeStudySession` (#187), on the admin client, since no
 * Student is signed in.
 */

/**
 * Claims the ended session for its close: sets `close_started_at` where it
 * is null. False when it is claimed already or has not ended.
 */
export async function claimSessionClose(sessionId: string): Promise<boolean> {
  "use step";
  const { data, error } = await createAdminClient()
    .from("study_sessions")
    .update({ close_started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("close_started_at", null)
    .not("ended_at", "is", null)
    .select("id");
  if (error) failed("Claiming the Study session's close", error);
  return data.length > 0;
}

/** The session's notes to store, with when the Memory read was written. */
export type SessionClose = CloseNotes & {
  /** The `updated_at` of the Memory the call read; null without one. */
  memoryReadAt: string | null;
};

/**
 * Writes the session's notes with one `close` call. Null, without a call,
 * for a session without a Chat (a mock) or without a Student message.
 * Throws when the call fails, so the workflow retries the step.
 */
export async function writeSessionClose(
  sessionId: string,
): Promise<SessionClose | null> {
  "use step";
  const supabase = createAdminClient();
  const loaded = await loadCloseSource(supabase, sessionId);
  if (!loaded) return null;
  const input = buildCloseInput(loaded.source);
  if (!input) return null;
  const { call, notes } = closeCall(input);
  const result = await meteredGenerate(
    supabase,
    {
      studentId: loaded.owner,
      task: "close",
      traceName: "close-study-session",
      dailyLimit: "ignore",
    },
    call,
  );
  // The provider's daily quota: a later retry may get through.
  if (!result) throw new Error("The close call got no answer.");
  return {
    ...guardedNotes(notes(result.output), loaded.source.memory),
    memoryReadAt: loaded.memoryReadAt,
  };
}

async function loadCloseSource(supabase: Supabase, sessionId: string) {
  const { data: session, error } = await supabase
    .from("study_sessions")
    .select("owner, course_id, chat_id, mode, topic_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) failed("Loading the Study session", error);
  if (!session?.chat_id) return null;
  const [messages, topic, topicNote, questions, attempts, memory] =
    await Promise.all([
      supabase
        .from("chat_messages")
        .select("role, parts, created_at")
        .eq("chat_id", session.chat_id)
        .order("created_at", { ascending: true }),
      session.topic_id === null
        ? null
        : supabase
            .from("topics")
            .select("name")
            .eq("id", session.topic_id)
            .maybeSingle(),
      session.topic_id === null
        ? null
        : supabase
            .from("topic_notes")
            .select("text")
            .eq("topic_id", session.topic_id)
            .maybeSingle(),
      supabase
        .from("questions")
        .select("id, prompt, answer_text, asked_at")
        .eq("session_id", sessionId)
        .order("asked_at", { ascending: true }),
      supabase
        .from("attempts")
        .select("question_id, kc_id, result, help")
        .eq("session_id", sessionId),
      supabase
        .from("memories")
        .select("text, updated_at")
        .eq("course_id", session.course_id)
        .maybeSingle(),
    ]);
  if (messages.error) failed("Loading the session's messages", messages.error);
  if (topic?.error) failed("Loading the session's Topic", topic.error);
  if (topicNote?.error) failed("Loading the Topic note", topicNote.error);
  if (questions.error)
    failed("Loading the session's Questions", questions.error);
  if (attempts.error) failed("Loading the session's attempts", attempts.error);
  if (memory.error) failed("Loading the Memory", memory.error);
  const kcNames = await loadKcNames(
    supabase,
    attempts.data.map(({ kc_id }) => kc_id),
  );
  const source: CloseSource = {
    mode: session.mode,
    topicName: topic?.data?.name ?? null,
    messages: messages.data,
    questions: questions.data.map((question) => ({
      prompt: question.prompt,
      answer: question.answer_text,
      attempts: attempts.data
        .filter(({ question_id }) => question_id === question.id)
        .map(({ kc_id, result, help }) => ({
          kcName: kcNames.get(kc_id) ?? "Unknown KC",
          result,
          help,
        })),
    })),
    topicNote: topicNote?.data?.text ?? null,
    memory: memory.data?.text ?? "",
  };
  return {
    owner: session.owner,
    source,
    memoryReadAt: memory.data?.updated_at ?? null,
  };
}

async function loadKcNames(
  supabase: Supabase,
  kcIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(kcIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("kcs")
    .select("id, name")
    .in("id", ids);
  if (error) failed("Loading the attempts' KCs", error);
  return new Map(data.map(({ id, name }) => [id, name]));
}

/**
 * Stores the session's notes in one transaction (`store_session_close`).
 * A session that has its notes already is left as it is.
 */
export async function storeSessionClose(
  sessionId: string,
  close: SessionClose,
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("store_session_close", {
    p_session_id: sessionId,
    p_session_note: close.sessionNote,
    p_memory_lines: close.memoryLines,
    ...(close.topicNote !== null && { p_topic_note: close.topicNote }),
    ...(close.condensedMemory !== null &&
      close.memoryReadAt !== null && {
        p_condensed_memory: close.condensedMemory,
        p_memory_read_at: close.memoryReadAt,
      }),
  });
  if (error) failed("Storing the session's notes", error);
}
