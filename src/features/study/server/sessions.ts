import "server-only";
import {
  parseSessionMode,
  type SessionMode,
} from "@/features/study/domain/modes";
import { sessionEnd } from "@/features/study/domain/replay";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * When a Chat's Study session ends: End session writes `ended_at`, and a
 * session idle for 2 hours counts as ended at its newest message
 * (`sessionEnd`), which reads compute without writing.
 */

type ChatSession = {
  id: string;
  endedAt: string | null;
  newestMessageAt: string | null;
};

async function loadChatSession(
  supabase: Supabase,
  chatId: string,
): Promise<ChatSession | null> {
  const [session, chat] = await Promise.all([
    supabase
      .from("study_sessions")
      .select("id, ended_at")
      .eq("chat_id", chatId)
      .maybeSingle(),
    supabase
      .from("chats")
      .select("last_message_at")
      .eq("id", chatId)
      .maybeSingle(),
  ]);
  if (session.error) failed("Loading the Study session", session.error);
  if (chat.error) failed("Loading the Chat", chat.error);
  if (!session.data) return null;
  return {
    id: session.data.id,
    endedAt: session.data.ended_at,
    newestMessageAt: chat.data?.last_message_at ?? null,
  };
}

/**
 * When the Chat's Study session ended at `now`, as an ISO timestamp; null
 * while it runs, or when the Chat has none.
 */
export async function getSessionEnd(
  supabase: Supabase,
  chatId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const session = await loadChatSession(supabase, chatId);
  return session && sessionEnd(session, now);
}

/** The Chat's Study session's mode; learn when the Chat has none. */
export async function getSessionMode(
  supabase: Supabase,
  chatId: string,
): Promise<SessionMode> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("mode")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) failed("Loading the Study session", error);
  return parseSessionMode(data?.mode);
}

/**
 * Switches a new Chat's session to review or practice. False, leaving it
 * learn, when it is not the caller's, has ended, has a Topic or a question.
 */
export async function startSessionMode(
  supabase: Supabase,
  chatId: string,
  mode: SessionMode,
): Promise<boolean> {
  const session = await loadChatSession(supabase, chatId);
  if (!session) return false;
  const { data, error } = await supabase.rpc("start_study_session_mode", {
    p_session_id: session.id,
    p_mode: mode,
  });
  if (error) failed("Setting the session's mode", error);
  return data === true;
}

/**
 * Whether the Chat's Study session has ended at `now`, for a message that
 * arrives in it. An idle session's end is written then, at its newest
 * message, so a later message cannot reopen it.
 */
export async function closeIdleSession(
  supabase: Supabase,
  chatId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const session = await loadChatSession(supabase, chatId);
  if (!session) return false;
  const end = sessionEnd(session, now);
  if (end === null) return false;
  if (session.endedAt === null) await endSession(supabase, chatId, end);
  return true;
}

/**
 * Ends the Chat's running Study session at `at`, and starts generating the
 * Course's review stock (#183). False when there is none to end: no
 * session, or one that ended already.
 */
export async function endSession(
  supabase: Supabase,
  chatId: string,
  at: string = new Date().toISOString(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from("study_sessions")
    .update({ ended_at: at })
    .eq("chat_id", chatId)
    .is("ended_at", null)
    .select("id, course_id");
  if (error) failed("Ending the Study session", error);
  const ended = data[0];
  if (!ended) return false;
  // Loaded on use: `workflow/api` fails to import in the component tests
  // that reach this module through the Server Actions
  // (docs/agents/notes/workflow-imports.md).
  const { queueProblemGeneration } =
    await import("@/features/study/server/problem-generation");
  await queueProblemGeneration(supabase, ended.course_id, null);
  return true;
}
