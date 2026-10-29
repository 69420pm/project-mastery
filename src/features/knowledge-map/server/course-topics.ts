import "server-only";
import { z } from "zod";
import {
  topicAnchors,
  type ReadingSection,
} from "@/features/knowledge-map/domain/topic-reading";
import { loadStoredMap } from "@/features/knowledge-map/server/stored-map";
import { loadStoredReadingSections } from "@/features/knowledge-map/server/stored-reading-sections";
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
  /** The Topic's stored Reading sections, in order. */
  readingSections: ReadingSection[];
};

/**
 * The Course's Topics in Course order, each with its KCs in teaching order,
 * its anchors, derived on read, and its stored Reading sections (ADR 0020).
 * Empty before a build stored Topics; a Topic has no sections before a
 * build stored them. Reads for the signed-in
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
  const [map, sections] = await Promise.all([
    loadStoredMap(supabase, courseId),
    loadStoredReadingSections(supabase, courseId),
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
    readingSections: sections.get(topic.id) ?? [],
  }));
}
