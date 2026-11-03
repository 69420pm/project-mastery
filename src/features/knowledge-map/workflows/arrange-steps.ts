import "server-only";
import { loadChunkSources } from "@/features/ingestion/server";
import { SAME_KC_SIMILARITY } from "@/features/knowledge-map/domain/kc-clusters";
import { exerciseLabel } from "@/features/knowledge-map/domain/exercise-label";
import { redundantLinks } from "@/features/knowledge-map/domain/prerequisite-cycles";
import {
  planTopicTree,
  storedAsProposed,
  withUnsourced,
} from "@/features/knowledge-map/domain/topic-tree";
import { teachingOrder } from "@/features/knowledge-map/domain/topics";
import type { CheckReport } from "@/features/knowledge-map/schemas";
import {
  loadStoredTree,
  treeKcs,
  type TreeProposal,
} from "@/features/knowledge-map/workflows/topic-steps";
import {
  retireUnsourcedKcs,
  touchBuild,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  courseOrder,
  loadMapInput,
  type MapInput,
} from "@/features/knowledge-map/workflows/map-input";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The last step of a build: the map in Course order with its Topic tree
 * and check report.
 */

/** The most duplicate pairs the check report lists. */
const MAX_DUPLICATES = 100;

/**
 * Ends a build: retires the KCs whose sources went meanwhile, puts the KCs
 * in the order of their first sources, each KC without sources directly
 * before the KC it is placed by, and the Exercises in Course order,
 * stores the Topic tree `tree` proposes (or the stored one again) with each
 * Topic's KCs in teaching order, drops redundant Prerequisites, stores the
 * check report and marks the build built.
 */
export async function arrangeKnowledgeMap(
  courseId: string,
  tree: TreeProposal,
): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  if (!(await touchBuild(supabase, courseId))) return;
  await retireUnsourcedKcs(supabase, courseId);

  const [input, stored] = await Promise.all([
    loadMapInput(supabase, courseId),
    loadStoredTree(supabase, courseId),
  ]);
  const { sourced, anchors } = courseOrder(input);
  const kcs = withUnsourced(sourced, anchors);
  const topics = planTopicTree({
    proposed: tree.topics ?? storedAsProposed(stored),
    chapters: input.chapters,
    kcs: treeKcs(input),
    storedIds: new Set(stored.map((topic) => topic.id)),
    unsourced: anchors,
  }).map((topic) => ({
    ...topic,
    kcs: teachingOrder(topic.kcs, input.prerequisites),
  }));
  const { error } = await supabase.rpc("arrange_knowledge_map", {
    p_course_id: courseId,
    p_kcs: kcs,
    p_topics: topics,
    p_topic_tree_hash: tree.hash,
    p_dropped_prerequisites: redundantLinks(input.prerequisites),
    p_check_report: await checkReport(supabase, courseId, input),
  });
  if (error) failed("Arranging the knowledge map", error);
}

/**
 * What the build checks: Chapters with content of their own that no live
 * KC cites, Exercises without KCs and the KC pairs still alike after
 * merging.
 */
async function checkReport(
  supabase: AdminSupabase,
  courseId: string,
  input: MapInput,
): Promise<CheckReport> {
  const [exercises, alike] = await Promise.all([
    exercisesWithoutKcs(supabase, courseId),
    supabase.rpc("alike_kcs", {
      p_course_id: courseId,
      p_similarity: SAME_KC_SIMILARITY,
      p_count: MAX_DUPLICATES,
    }),
  ]);
  if (alike.error) failed("Finding alike KCs", alike.error);

  const chapterOf = new Map(
    input.chunks.map((chunk) => [chunk.id, chunk.chapterId]),
  );
  const cited = new Set(
    input.kcs.flatMap((kc) => kc.sources.map((id) => chapterOf.get(id))),
  );
  const teaching = new Set(
    input.chunks.flatMap((chunk) =>
      chunk.label === "content" && chunk.chapterId ? [chunk.chapterId] : [],
    ),
  );
  const name = new Map(input.kcs.map((kc) => [kc.id, kc.name]));
  return {
    chaptersWithoutKcs: input.chapters
      .filter((chapter) => teaching.has(chapter.id) && !cited.has(chapter.id))
      .map((chapter) => chapter.title),
    exercisesWithoutKcs: exercises,
    duplicates: alike.data.flatMap(({ a, b, similarity }) =>
      name.has(a) && name.has(b)
        ? [{ a: name.get(a)!, b: name.get(b)!, similarity }]
        : [],
    ),
  };
}

/** The labels of the Course's Exercises that test no KC, in Course order. */
async function exercisesWithoutKcs(
  supabase: AdminSupabase,
  courseId: string,
): Promise<string[]> {
  const [exercises, tested] = await Promise.all([
    allRows("Loading the Exercises", (from, to) =>
      supabase
        .from("exercises")
        .select("id, question_chunk_id")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
    allRows("Loading the exercise KCs", (from, to) =>
      supabase
        .from("exercise_kcs")
        .select("exercise_id")
        .eq("course_id", courseId)
        .order("exercise_id")
        .range(from, to),
    ),
  ]);
  const testing = new Set(tested.map((row) => row.exercise_id));
  const untested = exercises.filter((exercise) => !testing.has(exercise.id));
  if (untested.length === 0) return [];
  const chunks = await loadChunkSources(
    supabase,
    untested.map((exercise) => exercise.question_chunk_id),
  );
  const chunkOf = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return untested.map((exercise) => {
    const chunk = chunkOf.get(exercise.question_chunk_id);
    return chunk ? exerciseLabel(chunk) : "Exercise";
  });
}
