import "server-only";
import {
  loadCourseChunkSpans,
  type ChunkSpan,
} from "@/features/ingestion/server";
import type {
  ReadingSection,
  SectionToStore,
} from "@/features/knowledge-map/domain/topic-reading";
import type { Topic } from "@/features/knowledge-map/domain/topics";
import { loadStoredMap } from "@/features/knowledge-map/server/stored-map";
import { loadStoredReadingSections } from "@/features/knowledge-map/server/stored-reading-sections";
import { loadStoredTopics } from "@/features/knowledge-map/server/stored-topics";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The steps of the Reading stage of a Knowledge map build (#178), which runs
 * on the stored Topics after `storeTopics`, on the admin client like the
 * other steps (`build-steps.ts`).
 */

/** What the Reading stage reads once, after the Topics are stored. */
export type ReadingInput = {
  topics: Array<Topic & { id: string }>;
  /** KC id to the chunks it cites. */
  kcSources: Record<string, string[]>;
  /** The Course's parsed chunks in reading order. */
  spans: ChunkSpan[];
  stored: Array<ReadingSection & { topicId: string }>;
};

/**
 * The stored Topics, the chunks their KCs cite, the Course's chunk places
 * and the stored sections of the Course whose build runs. Null when no build
 * runs any more.
 */
export async function loadReadingInput(
  courseId: string,
): Promise<ReadingInput | null> {
  "use step";
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("knowledge_map_builds")
    .select("owner")
    .eq("course_id", courseId)
    .eq("status", "building")
    .maybeSingle();
  if (error) failed("Loading the build", error);
  if (!data) return null;
  const [topics, map, spans, sections] = await Promise.all([
    loadStoredTopics(supabase, courseId),
    loadStoredMap(supabase, courseId),
    loadCourseChunkSpans(supabase, courseId),
    loadStoredReadingSections(supabase, courseId),
  ]);
  return {
    topics,
    kcSources: Object.fromEntries(map.kcs.map((kc) => [kc.id, kc.sources])),
    spans,
    stored: [...sections.entries()].flatMap(([topicId, rows]) =>
      rows.map((row) => ({ ...row, topicId })),
    ),
  };
}

/**
 * Makes the stored Reading sections these and marks the build built, in one
 * transaction. A section with an id keeps its stored mode and texts; a new
 * one is stored with its `original` mode and reason. Does nothing when no
 * build runs any more.
 */
export async function storeReadingSections(
  courseId: string,
  sections: SectionToStore[],
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("replace_reading_sections", {
    p_course_id: courseId,
    p_sections: sections.map(({ id, topicId, position, cut, ...rest }) => ({
      id,
      topic: topicId,
      material: cut.materialId,
      position,
      pageFrom: cut.pageFrom,
      pageTo: cut.pageTo,
      chunkIds: cut.chunkIds,
      ...rest,
    })),
  });
  if (error) failed("Storing the reading sections", error);
}
