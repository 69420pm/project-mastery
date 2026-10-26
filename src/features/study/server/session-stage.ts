import "server-only";
import type { loadStoredTopics } from "@/features/knowledge-map/server";
import { resumeStage, startStage } from "@/features/study/domain/stages";
import type { TodayTopic } from "@/features/study/domain/today";
import { queueProblemGeneration } from "@/features/study/server/problem-generation";
import {
  loadPreviousStage,
  startSessionTopic,
  type StageSession,
} from "@/features/study/server/stages";
import type { TutorSession } from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The session's Topic and stage. The first reply sets them, from the plan's
 * next Topic (`next`) and `startStage`; later replies read them. Null
 * without a Topic.
 */
export async function sessionStage(
  supabase: Supabase,
  {
    courseId,
    session,
    next,
    topics,
    reviewsDue,
    now,
  }: {
    courseId: string;
    session: StageSession;
    /** The Topic to set when the session has none; null to set none. */
    next: TodayTopic | null;
    topics: Awaited<ReturnType<typeof loadStoredTopics>>;
    reviewsDue: boolean;
    now: Date;
  },
): Promise<{ topic: TodayTopic; session: TutorSession } | null> {
  const topicId = session.topicId ?? next?.id;
  if (!topicId) return null;
  const previous = await loadPreviousStage(
    supabase,
    topicId,
    session.startedAt,
  );
  let { stage } = session;
  if (session.topicId === null) {
    stage = startStage(previous, reviewsDue);
    if (!(await startSessionTopic(supabase, session.id, topicId, stage))) {
      return null;
    }
    // Topic stock: the Topic's Problems are generated in the background.
    await queueProblemGeneration(supabase, courseId, topicId);
  }
  const topic = topics.find(({ id }) => id === topicId);
  if (!topic || stage === null) return null;
  return {
    topic: {
      id: topic.id,
      name: topic.name,
      centralQuestion: topic.centralQuestion,
      kcs: topic.kcs,
    },
    session: {
      stage,
      afterReview: resumeStage(previous),
      minutes: Math.floor(
        (now.getTime() - new Date(session.startedAt).getTime()) / 60_000,
      ),
    },
  };
}
