import "server-only";
import { z } from "zod";
import { loadCourseChunkSpans } from "@/features/ingestion/server";
import {
  topicAnchors,
  topicReadingSections,
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
  /** In teaching order. */
  kcs: TopicKc[];
  /** Prerequisites from outside the Topic, in map order. */
  anchors: TopicKc[];
  /** The Topic's Reading sections, cut on this read, in order. */
  readingSections: ReadingSection[];
};

/**
 * The Course's Topics in Course order, each with its KCs in teaching order,
 * its anchors and its Reading sections, both derived on read (ADR 0020).
 * Empty before a build stored Topics. Reads for the signed-in Student,
 * where Row Level Security leaves another Student's Course empty, or on
 * `client` when given, such as the admin client of a workflow.
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
  const [map, chunks] = await Promise.all([
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
    kcs: topic.kcs.map(listed),
    anchors: topicAnchors(topic.kcs, map),
    readingSections: topicReadingSections(
      topic.id,
      topic.kcs.flatMap((id) => kcs.get(id)?.sources ?? []),
      chunks,
    ),
  }));
}

/**
 * The Course's Reading sections as they are cut now, by Topic id, each
 * Topic's in order. On a Student's session client, Row Level Security
 * leaves another Student's Course empty.
 */
export async function loadReadingSections(
  supabase: Supabase,
  courseId: string,
): Promise<Map<string, ReadingSection[]>> {
  const topics = await loadCourseTopics(courseId, supabase);
  return new Map(topics.map((topic) => [topic.id, topic.readingSections]));
}

/**
 * One Reading section of the Course as it is cut now, or null when no
 * Topic has a section with this id. On a Student's session client, Row
 * Level Security leaves out another Student's Course.
 */
export async function findReadingSection(
  supabase: Supabase,
  courseId: string,
  sectionId: string,
): Promise<ReadingSection | null> {
  const sections = await loadReadingSections(supabase, courseId);
  for (const topicSections of sections.values()) {
    const section = topicSections.find(({ id }) => id === sectionId);
    if (section) return section;
  }
  return null;
}
