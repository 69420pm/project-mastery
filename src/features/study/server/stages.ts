import "server-only";
import { isStage, type Stage } from "@/features/study/domain/stages";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * A learn session's Topic and stage (#180): the first reply sets both, and
 * `setStage` moves the stage on. Students write neither column themselves:
 * the database functions write them on the caller's own running session.
 */

/** A Chat's Study session as its stages read it. */
export type StageSession = {
  id: string;
  /** Null until the first reply sets it, and in a Course without Topics. */
  topicId: string | null;
  /** Null without a Topic. */
  stage: Stage | null;
  startedAt: string;
};

/** The Chat's Study session with its Topic and stage; null without one. */
export async function loadStageSession(
  supabase: Supabase,
  chatId: string,
): Promise<StageSession | null> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("id, topic_id, stage, started_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) failed("Loading the Study session", error);
  if (!data) return null;
  return {
    id: data.id,
    topicId: data.topic_id,
    stage: isStage(data.stage) ? data.stage : null,
    startedAt: data.started_at,
  };
}

/**
 * The stage the Topic's most recent session started before `before` stopped
 * at; null when there is none.
 */
export async function loadPreviousStage(
  supabase: Supabase,
  topicId: string,
  before: string,
): Promise<Stage | null> {
  const { data, error } = await supabase
    .from("study_sessions")
    .select("stage")
    .eq("topic_id", topicId)
    .lt("started_at", before)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) failed("Loading the Topic's last session", error);
  return isStage(data?.stage) ? data.stage : null;
}

/**
 * Sets the session's Topic and start stage, once. False when it has a Topic
 * already, has ended, or the Topic is not of its Course.
 */
export async function startSessionTopic(
  supabase: Supabase,
  sessionId: string,
  topicId: string,
  stage: Stage,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("start_study_session_topic", {
    p_session_id: sessionId,
    p_topic_id: topicId,
    p_stage: stage,
  });
  if (error) failed("Setting the session's Topic", error);
  return data === true;
}

/**
 * Moves the session to a stage. False when it has ended, has no Topic or is
 * at close.
 */
export async function saveStage(
  supabase: Supabase,
  sessionId: string,
  stage: Stage,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_study_session_stage", {
    p_session_id: sessionId,
    p_stage: stage,
  });
  if (error) failed("Moving the session's stage", error);
  return data === true;
}

/**
 * The Reading sections of `sectionIds` the Student has a Done message for,
 * in any of their Chats.
 */
export async function loadDoneSections(
  supabase: Supabase,
  sectionIds: string[],
): Promise<Set<string>> {
  if (sectionIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("reading_section_id")
    .in("reading_section_id", sectionIds);
  if (error) failed("Loading the read sections", error);
  return new Set(data.flatMap((row) => row.reading_section_id ?? []));
}
