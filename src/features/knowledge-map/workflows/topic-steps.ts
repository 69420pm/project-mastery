import "server-only";
import {
  MAX_TOPIC_NAME,
  topicNamingMessages,
  topicNamingSchema,
  topicNamingSettings,
  type OfferedTopic,
} from "@/features/knowledge-map/ai/topic-naming";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import { SAME_KC_SIMILARITY } from "@/features/knowledge-map/domain/kc-clusters";
import { exerciseLabel } from "@/features/knowledge-map/domain/exercise-label";
import {
  planMap,
  sameParts,
  type MapPlan,
  type PlannedTopic,
} from "@/features/knowledge-map/domain/map-plan";
import { redundantLinks } from "@/features/knowledge-map/domain/prerequisite-cycles";
import {
  storedExtractionSchema,
  type CheckReport,
} from "@/features/knowledge-map/schemas";
import {
  loadCourseLanguage,
  PARTS_PER_STEP,
  retireUnsourcedKcs,
  runCalls,
  touchBuild,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  loadMapInput,
  type MapInput,
} from "@/features/knowledge-map/workflows/map-input";
import { meteredGenerate } from "@/features/usage/server";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The last steps of a build: Topics and Big ideas from Parts in code
 * (`planMap`), one naming call (task `topic`) per Big idea with new
 * Topics, then the map in Course order with its check report.
 */

const MAX_CENTRAL_QUESTION = 500;
/** The most duplicate pairs the check report lists. */
const MAX_DUPLICATES = 100;

type StoredTopic = { id: string; part_hashes: string[] };

/** The plan of the Course's map, with the stored Topics. */
async function loadPlan(supabase: AdminSupabase, courseId: string) {
  const [input, topics] = await Promise.all([
    loadMapInput(supabase, courseId),
    allRows("Loading the Topics", (from, to) =>
      supabase
        .from("topics")
        .select("id, part_hashes")
        .eq("course_id", courseId)
        .order("position")
        .range(from, to),
    ),
  ]);
  return { input, plan: planMap(input), stored: topics };
}

const storedTopicOf = (topic: PlannedTopic, stored: StoredTopic[]) =>
  stored.find((row) => sameParts(row.part_hashes, topic.partHashes));

/** The most Topics one naming call names, so no prompt grows with a chapter. */
const TOPICS_PER_CALL = 10;

/**
 * Names the planned Topics no stored Topic holds the Parts of: one call per
 * Big idea, or per TOPICS_PER_CALL of its Topics, up to PARTS_PER_STEP
 * calls a step, each stored as it finishes. A reached Daily limit stops the
 * build.
 */
export async function nameTopics(courseId: string): Promise<StepOutcome> {
  "use step";
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };
  await retireUnsourcedKcs(supabase, courseId);

  const { input, plan, stored } = await loadPlan(supabase, courseId);
  const unnamed = plan.topics.filter((topic) => !storedTopicOf(topic, stored));
  const batches = [...Map.groupBy(unnamed, (topic) => topic.bigIdea)].flatMap(
    ([bigIdea, topics]) =>
      Array.from(
        { length: Math.ceil(topics.length / TOPICS_PER_CALL) },
        (_, index) =>
          [
            bigIdea,
            topics.slice(
              index * TOPICS_PER_CALL,
              (index + 1) * TOPICS_PER_CALL,
            ),
          ] as const,
      ),
  );
  if (batches.length === 0) return { ok: true, left: 0 };

  const language = await loadCourseLanguage(supabase, courseId);
  const kcName = new Map(input.kcs.map((kc) => [kc.id, kc.name]));
  let done = 0;
  let limitReached = false;
  let running = true;
  await runCalls(
    batches.slice(0, PARTS_PER_STEP),
    async ([bigIdea, topics]) => {
      const offered = topics.map((topic, index): OfferedTopic => ({
        id: `t${index + 1}`,
        parts: topic.partTitles,
        kcs: topic.kcs.map((id) => kcName.get(id) ?? id),
      })) as [OfferedTopic, ...OfferedTopic[]];
      const call = { bigIdea, language, topics: offered };
      const result = await meteredGenerate(
        supabase,
        { studentId: owner, task: "topic", traceName: "name-topics" },
        { ...topicNamingSettings(call), messages: topicNamingMessages(call) },
      );
      if (!result) {
        limitReached = true;
        return "stop";
      }
      const named = topicNamingSchema(offered.map((topic) => topic.id)).parse(
        result.output,
      ).topics;
      const { data, error } = await supabase.rpc("store_named_topics", {
        p_course_id: courseId,
        p_topics: topics.map((topic, index) => {
          const { name, centralQuestion } = named[offered[index]!.id]!;
          return {
            bigIdea,
            name: name.trim().slice(0, MAX_TOPIC_NAME) || topic.partTitles[0],
            centralQuestion:
              centralQuestion.trim().slice(0, MAX_CENTRAL_QUESTION) ||
              topic.partTitles[0],
            partHashes: topic.partHashes,
          };
        }),
      });
      if (error) failed("Storing the named Topics", error);
      if (!data) {
        running = false;
        return "stop";
      }
      done += 1;
    },
  );
  if (!running) return { ok: true, left: null };
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: batches.length - done };
}

/**
 * Ends a build: retires the KCs whose sources went meanwhile, puts the Big
 * ideas, KCs, Topics and Exercises in Course order, drops redundant
 * Prerequisites, stores the check report and marks the build built. A
 * planned Topic that is not named yet is left out until the next build.
 */
export async function arrangeKnowledgeMap(courseId: string): Promise<void> {
  "use step";
  const supabase = createAdminClient();
  if (!(await touchBuild(supabase, courseId))) return;
  await retireUnsourcedKcs(supabase, courseId);

  const { input, plan, stored } = await loadPlan(supabase, courseId);
  const topics = plan.topics.flatMap((topic) => {
    const row = storedTopicOf(topic, stored);
    return row ? [{ id: row.id, bigIdea: topic.bigIdea, kcs: topic.kcs }] : [];
  });
  const { error } = await supabase.rpc("arrange_knowledge_map", {
    p_course_id: courseId,
    p_big_ideas: plan.bigIdeas,
    p_kcs: plan.kcs,
    p_topics: topics,
    p_dropped_prerequisites: redundantLinks(input.prerequisites),
    p_check_report: await checkReport(supabase, courseId, input, plan),
  });
  if (error) failed("Arranging the knowledge map", error);
}

/**
 * What the build checks: each teaching Part's extracted KCs against its
 * budget, teaching Parts no live KC cites, Exercises without KCs and the
 * KC pairs still alike after merging.
 */
async function checkReport(
  supabase: AdminSupabase,
  courseId: string,
  input: MapInput,
  plan: MapPlan,
): Promise<CheckReport> {
  const [extractions, exercises, alike] = await Promise.all([
    allRows("Loading the Part extractions", (from, to) =>
      supabase
        .from("part_extractions")
        .select("part_id, output")
        .eq("course_id", courseId)
        .order("part_id")
        .range(from, to),
    ),
    exercisesWithoutKcs(supabase, courseId),
    supabase.rpc("alike_kcs", {
      p_course_id: courseId,
      p_similarity: SAME_KC_SIMILARITY,
      p_count: MAX_DUPLICATES,
    }),
  ]);
  if (alike.error) failed("Finding alike KCs", alike.error);

  const outputOf = new Map(
    extractions.map((row) => [
      row.part_id,
      storedExtractionSchema.parse(row.output),
    ]),
  );
  const teaching = input.parts.filter((part) => part.kind === "teaching");
  const partOf = new Map(input.chunks.map((chunk) => [chunk.id, chunk.partId]));
  const cited = new Set(
    input.kcs.flatMap((kc) => kc.sources.map((id) => partOf.get(id))),
  );
  const name = new Map(input.kcs.map((kc) => [kc.id, kc.name]));
  const placed = new Set(plan.kcs.map((kc) => kc.id));
  return {
    kcsPerPart: teaching.flatMap((part) => {
      const output = outputOf.get(part.id);
      return output
        ? [
            {
              part: part.title,
              kcs: output.kcs.length,
              budget: output.kcBudget ?? 0,
            },
          ]
        : [];
    }),
    partsWithoutKcs: teaching
      .filter((part) => !cited.has(part.id))
      .map((part) => part.title),
    exercisesWithoutKcs: exercises,
    duplicates: alike.data.flatMap(({ a, b, similarity }) =>
      placed.has(a) && placed.has(b)
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
  const [chunks, materials] = await Promise.all([
    supabase
      .from("chunks")
      .select("id, material_id, page_from, exercise_number")
      .in(
        "id",
        untested.map((exercise) => exercise.question_chunk_id),
      ),
    supabase.from("materials").select("id, name").eq("course_id", courseId),
  ]);
  if (chunks.error) failed("Loading the Exercises' chunks", chunks.error);
  if (materials.error) failed("Loading the Materials", materials.error);
  const chunkOf = new Map(chunks.data.map((chunk) => [chunk.id, chunk]));
  const materialName = new Map(materials.data.map((m) => [m.id, m.name]));
  return untested.map((exercise) => {
    const chunk = chunkOf.get(exercise.question_chunk_id);
    return chunk
      ? exerciseLabel({
          exerciseNumber: chunk.exercise_number,
          materialName: materialName.get(chunk.material_id) ?? "",
          pageFrom: chunk.page_from,
        })
      : "Exercise";
  });
}
