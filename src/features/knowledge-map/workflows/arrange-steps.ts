import "server-only";
import { loadChunkSources } from "@/features/ingestion/server";
import { SAME_KC_SIMILARITY } from "@/features/knowledge-map/domain/kc-clusters";
import { exerciseLabel } from "@/features/knowledge-map/domain/exercise-label";
import { redundantLinks } from "@/features/knowledge-map/domain/prerequisite-cycles";
import {
  planTopicTree,
  storedAsProposed,
} from "@/features/knowledge-map/domain/topic-tree";
import { teachingOrder } from "@/features/knowledge-map/domain/topics";
import type { CheckReport } from "@/features/knowledge-map/schemas";
import {
  loadKcVectors,
  loadStoredTree,
  treeKcs,
  type TreeProposal,
} from "@/features/knowledge-map/workflows/topic-steps";
import {
  MIN_UNIT_COVERAGE,
  unitCoverage,
} from "@/features/knowledge-map/domain/unit-coverage";
import {
  loadCourseUnits,
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
 * in the order of their first sources and the Exercises in Course order,
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

  const [input, stored, vectors] = await Promise.all([
    loadMapInput(supabase, courseId),
    loadStoredTree(supabase, courseId),
    loadKcVectors(supabase, courseId),
  ]);
  const kcs = courseOrder(input);
  const topics = planTopicTree({
    proposed: tree.topics ?? storedAsProposed(stored),
    chapters: input.chapters,
    kcs: treeKcs(input, vectors),
    stored,
  }).map((topic) => ({
    ...topic,
    kcs: teachingOrder(topic.kcs, input.prerequisites),
  }));
  const { error } = await supabase.rpc("arrange_knowledge_map", {
    p_course_id: courseId,
    p_kcs: kcs,
    p_topics: topics,
    // Generated types make every argument non-null; the column takes null.
    p_topic_tree_hash: tree.hash as string,
    p_dropped_prerequisites: redundantLinks(input.prerequisites),
    p_check_report: await checkReport(supabase, courseId, input),
  });
  if (error) failed("Arranging the knowledge map", error);
}

/**
 * What the build checks: Chapters with content of their own that no live
 * KC cites, Exercises without KCs, the KC pairs still alike after merging,
 * the teaching units whose KCs cite less than MIN_UNIT_COVERAGE of them,
 * and the pages read without units.
 */
async function checkReport(
  supabase: AdminSupabase,
  courseId: string,
  input: MapInput,
): Promise<CheckReport> {
  const [exercises, alike, units, unreadPages] = await Promise.all([
    exercisesWithoutKcs(supabase, courseId),
    supabase.rpc("alike_kcs", {
      p_course_id: courseId,
      p_similarity: SAME_KC_SIMILARITY,
      p_count: MAX_DUPLICATES,
    }),
    loadCourseUnits(supabase, courseId, "content"),
    loadUnreadPages(supabase, courseId),
  ]);
  if (alike.error) failed("Finding alike KCs", alike.error);
  const citedChunks = input.kcs.flatMap((kc) => kc.sources);
  const unitsBelowCoverage = units.flatMap((unit) => {
    const coverage = unitCoverage(unit.chunks, citedChunks);
    return coverage < MIN_UNIT_COVERAGE
      ? [{ chapter: unit.title, coverage }]
      : [];
  });

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
      .filter(
        (chapter) =>
          !chapter.inExam && teaching.has(chapter.id) && !cited.has(chapter.id),
      )
      .map((chapter) => chapter.title),
    exercisesWithoutKcs: exercises,
    duplicates: alike.data.flatMap(({ a, b, similarity }) =>
      name.has(a) && name.has(b)
        ? [{ a: name.get(a)!, b: name.get(b)!, similarity }]
        : [],
    ),
    unitsBelowCoverage,
    unreadPages,
  };
}

/**
 * The pages of the Course's Materials that were read without units,
 * `unreadable` or `uncovered`, per Material in Course order.
 */
async function loadUnreadPages(
  supabase: AdminSupabase,
  courseId: string,
): Promise<CheckReport["unreadPages"]> {
  const materials = await supabase
    .from("materials")
    .select("id, name")
    .eq("course_id", courseId)
    .order("position");
  if (materials.error) failed("Loading the Materials", materials.error);
  const pages = await allRows("Loading the unread pages", (from, to) =>
    supabase
      .from("material_pages")
      .select("material_id, page_number")
      .in(
        "material_id",
        materials.data.map((material) => material.id),
      )
      .in("skipped", ["unreadable", "uncovered"])
      .order("material_id")
      .order("page_number")
      .range(from, to),
  );
  return materials.data.flatMap((material) => {
    const unread = pages
      .filter((page) => page.material_id === material.id)
      .map((page) => page.page_number);
    return unread.length > 0
      ? [{ material: material.name, pages: unread }]
      : [];
  });
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
