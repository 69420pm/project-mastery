import "server-only";
import { z } from "zod";
import { loadCourseChunkSpans } from "@/features/ingestion/server";
import {
  readingSections,
  topicAnchors,
  type ReadingSection,
} from "@/features/knowledge-map/domain/topic-reading";
import { loadStoredMap } from "@/features/knowledge-map/server/stored-map";
import { loadStoredTopics } from "@/features/knowledge-map/server/stored-topics";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/supabase/types";

/** A KC as a Topic lists it. */
type TopicKc = { id: string; name: string };

/** A stored Topic with what a Student reads around it. */
export type CourseTopic = {
  id: string;
  bigIdeaId: string;
  name: string;
  centralQuestion: string;
  whyItMatters: string;
  /** In teaching order. */
  kcs: TopicKc[];
  /** Prerequisites from outside the Topic, prior KCs included, in map order. */
  anchors: TopicKc[];
  /** The Topic's source chunks, in Material order, cut into short sections. */
  readingSections: ReadingSection[];
};

/**
 * The Course's Topics in Course order, each with its KCs in teaching order,
 * its anchors and its Reading sections, which are derived on read (ADR
 * 0020). Empty before a build stored Topics. Reads for the signed-in
 * Student, where Row Level Security leaves another Student's Course empty,
 * or on `client` when given, such as the admin client of a workflow.
 */
export async function loadCourseTopics(
  courseId: string,
  client?: Supabase,
): Promise<CourseTopic[]> {
  if (!client) {
    if (!z.uuid().safeParse(courseId).success || !(await getUser())) return [];
  }
  const supabase = client ?? (await createClient());
  const topics = await loadStoredTopics(supabase, courseId);
  if (topics.length === 0) return [];
  const [map, spans] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadCourseChunkSpans(supabase, courseId),
  ]);
  const kcs = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const listed = (id: string): TopicKc => ({
    id,
    name: kcs.get(id)?.name ?? id,
  });
  return topics.map((topic) => ({
    id: topic.id,
    bigIdeaId: topic.bigIdea,
    name: topic.name,
    centralQuestion: topic.centralQuestion,
    whyItMatters: topic.whyItMatters,
    kcs: topic.kcs.map(listed),
    anchors: topicAnchors(topic.kcs, map),
    readingSections: readingSections(
      topic.kcs.flatMap((id) => kcs.get(id)?.sources ?? []),
      spans,
    ),
  }));
}
