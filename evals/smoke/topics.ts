import { randomUUID } from "node:crypto";
import {
  buildKnowledgeMap,
  loadCourseTopics,
  type CourseTopic,
} from "@/features/knowledge-map/server";
import { insertGoldMap } from "./gold-map";
import { result, type SmokeCheck } from "./smoke-check";

type Supabase = Parameters<typeof insertGoldMap>[0];

/** The KCs that share one chunk, and so one page of the one Material. */
const KCS_PER_CHUNK = 4;

/**
 * Stores the jet-engines gold map with every KC sourced to a chunk of one
 * Material, all chunks processed, and runs the real `buildKnowledgeMap`
 * workflow on it, which then has no new chunks and makes only `topic` calls:
 * one per Big idea. Checks that every KC sits in one Topic, in teaching and
 * Course order, then reruns the build (no call, same Topic ids) and adds one
 * KC (one call, the stored Topics keep their ids and KCs). Prints the Topics
 * with their central questions, anchors and Reading sections to read by hand.
 */
export const topicsSmoke: SmokeCheck = {
  name: "topics",
  usage:
    "pnpm smoke topics (the jet-engines gold map, then the Topics stage three times: first, unchanged and with one new KC; prints the Topics)",
  // 4 Big ideas, then none, then one, with slack for retries.
  maxCalls: 10,
  async run({ supabase, studentId }) {
    const { data: course, error } = await supabase
      .from("courses")
      .insert({ owner: studentId, name: "Smoke check" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const courseId = course.id;
    const { gold, id } = await insertGoldMap(supabase, studentId, courseId);
    const sourced = gold.kcs.filter((kc) => kc.type !== "prior");
    const chunkIds = await insertChunks(supabase, {
      studentId,
      courseId,
      count: Math.ceil(sourced.length / KCS_PER_CHUNK),
    });
    const sources = sourced.map((kc, index) => ({
      owner: studentId,
      course_id: courseId,
      kc_id: id(kc.id),
      chunk_id: chunkIds[Math.floor(index / KCS_PER_CHUNK)] as string,
    }));
    await insertRows(supabase.from("kc_sources").insert(sources), "kc_sources");

    const first = await build(supabase, courseId);
    const topics = await loadCourseTopics(courseId, supabase);
    const calls = await topicCalls(supabase, studentId);
    print(topics);

    const unchanged = await build(supabase, courseId);
    const afterRerun = await loadCourseTopics(courseId, supabase);
    const rerunCalls = (await topicCalls(supabase, studentId)) - calls;

    // One new KC in the Big idea of the first KC, taught by its chunk.
    const bigIdeaId = id(sourced[0]?.bigIdea as string);
    const newKc = randomUUID();
    await insertRows(
      supabase.from("kcs").insert({
        id: newKc,
        owner: studentId,
        course_id: courseId,
        big_idea_id: bigIdeaId,
        name: "Smoke check KC",
        description: "A KC the smoke check adds after the first build.",
        type: "concept",
        bloom: "understand",
        origin: "content",
        position: gold.kcs.length,
      }),
      "kcs",
    );
    await insertRows(
      supabase.from("kc_sources").insert({
        owner: studentId,
        course_id: courseId,
        kc_id: newKc,
        chunk_id: chunkIds[0] as string,
      }),
      "kc_sources",
    );
    const updated = await build(supabase, courseId);
    const afterUpdate = await loadCourseTopics(courseId, supabase);
    const updateCalls =
      (await topicCalls(supabase, studentId)) - calls - rerunCalls;

    const { data: links, error: linksError } = await supabase
      .from("prerequisite_links")
      .select("from_kc, to_kc")
      .eq("course_id", courseId);
    if (linksError) throw new Error(linksError.message);

    const wanted = sourced.map((kc) => id(kc.id));
    const snapshot = (list: CourseTopic[]) =>
      JSON.stringify(list.map((topic) => [topic.id, topic.kcs]));
    const stored = new Map(topics.map((topic) => [topic.id, topic.kcs]));
    const kept = afterUpdate.filter((topic) => stored.has(topic.id));
    const keptKcs = (list: CourseTopic[]) =>
      list.every((topic) => {
        const before = stored.get(topic.id);
        return (
          before === undefined ||
          before.every((kc) => topic.kcs.some((item) => item.id === kc.id))
        );
      });
    const sizes = topics.map((topic) => topic.kcs.length);
    console.info(
      `\nTopic sizes: ${sizes.join(", ")} (3 to 10 KCs asked; not checked)`,
    );
    return [
      result("the first build is built", first === "built", first),
      result(
        "every non-prior KC is in exactly one Topic, and no prior KC is",
        placedOnce(topics, wanted),
      ),
      result(
        "no Topic is empty, and every Big idea has one",
        topics.every((topic) => topic.kcs.length > 0) &&
          gold.bigIdeas.every((bigIdea) =>
            topics.some((topic) => topic.bigIdeaId === id(bigIdea.id)),
          ),
      ),
      result(
        "each Topic lists its KCs after their Prerequisites",
        inTeachingOrder(topics, links),
      ),
      result(
        "Topics follow Prerequisites, except across a cycle",
        inCourseOrder(topics, links),
      ),
      result(
        "every Topic has a central question and reading sections",
        topics.every(
          (topic) =>
            topic.centralQuestion.trim() !== "" &&
            topic.readingSections.length > 0,
        ),
      ),
      result(
        "the unchanged rebuild is built",
        unchanged === "built",
        unchanged,
      ),
      result("the unchanged rebuild makes no topic call", rerunCalls === 0),
      result(
        "the unchanged rebuild keeps every Topic id and KC",
        snapshot(afterRerun) === snapshot(topics),
      ),
      result("the update build is built", updated === "built", updated),
      result(
        "the new KC costs one topic call",
        updateCalls === 1,
        `${updateCalls}`,
      ),
      result(
        "the new KC is in exactly one Topic",
        afterUpdate.filter((topic) => topic.kcs.some((kc) => kc.id === newKc))
          .length === 1,
      ),
      result(
        "the stored Topics keep their ids and KCs",
        kept.length === topics.length && keptKcs(afterUpdate),
        `${kept.length} of ${topics.length} Topic ids kept`,
      ),
    ];
  },
};

/** Runs the build workflow on the Course; returns the build's status. */
async function build(supabase: Supabase, courseId: string) {
  const { error } = await supabase
    .from("knowledge_map_builds")
    .update({ status: "building", failure_reason: null })
    .eq("course_id", courseId);
  if (error) throw new Error(error.message);
  await buildKnowledgeMap(courseId);
  const { data, error: statusError } = await supabase
    .from("knowledge_map_builds")
    .select("status, failure_reason")
    .eq("course_id", courseId)
    .single();
  if (statusError) throw new Error(statusError.message);
  return data.status === "built"
    ? "built"
    : `${data.status}: ${data.failure_reason}`;
}

/** The `topic` calls the Student's runs recorded so far. */
async function topicCalls(supabase: Supabase, studentId: string) {
  const { count, error } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("owner", studentId)
    .eq("task", "topic");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** One parsed Material with `count` chunks on pages 1 to `count`, all processed. */
async function insertChunks(
  supabase: Supabase,
  {
    studentId,
    courseId,
    count,
  }: { studentId: string; courseId: string; count: number },
): Promise<string[]> {
  const materialId = randomUUID();
  await insertRows(
    supabase.from("materials").insert({
      id: materialId,
      owner: studentId,
      course_id: courseId,
      name: "Lecture 1",
      media_type: "application/pdf",
      size_bytes: 1,
      storage_path: `${studentId}/${courseId}/${materialId}`,
      parse_status: "parsed",
    }),
    "materials",
  );
  const { data, error } = await supabase
    .from("chunks")
    .insert(
      Array.from({ length: count }, (_, position) => ({
        owner: studentId,
        course_id: courseId,
        material_id: materialId,
        position,
        page_from: position + 1,
        page_to: position + 1,
        label: "content",
        markdown: `Page ${position + 1} of the lecture.`,
      })),
    )
    .select("id, position");
  if (error) throw new Error(`chunks: ${error.message}`);
  const ids = data.toSorted((a, b) => a.position - b.position);
  await insertRows(
    supabase.from("knowledge_map_chunks").insert(
      ids.map((chunk) => ({
        owner: studentId,
        course_id: courseId,
        chunk_id: chunk.id,
      })),
    ),
    "knowledge_map_chunks",
  );
  return ids.map((chunk) => chunk.id);
}

async function insertRows(
  insert: PromiseLike<{ error: { message: string } | null }>,
  table: string,
) {
  const { error } = await insert;
  if (error) throw new Error(`${table}: ${error.message}`);
}

type Link = { from_kc: string; to_kc: string };

/** Whether the Topics hold exactly the `wanted` KCs, each once. */
function placedOnce(topics: CourseTopic[], wanted: string[]) {
  const placed = topics.flatMap((topic) => topic.kcs.map((kc) => kc.id));
  return (
    placed.length === wanted.length &&
    new Set(placed).size === placed.length &&
    wanted.every((kc) => placed.includes(kc))
  );
}

/** Whether no Topic lists a KC before a Prerequisite of it in the same Topic. */
function inTeachingOrder(topics: CourseTopic[], links: Link[]) {
  return topics.every((topic) => {
    const order = topic.kcs.map((kc) => kc.id);
    return links.every((link) => {
      const from = order.indexOf(link.from_kc);
      const to = order.indexOf(link.to_kc);
      return from === -1 || to === -1 || from < to;
    });
  });
}

/**
 * Whether every Prerequisite across Topics points forward in Course order,
 * unless the Topics also depend on each other the other way.
 */
function inCourseOrder(topics: CourseTopic[], links: Link[]) {
  const topicOf = new Map(
    topics.flatMap((topic, index) =>
      topic.kcs.map((kc) => [kc.id, index] as const),
    ),
  );
  const edges = new Set(
    links.flatMap((link) => {
      const from = topicOf.get(link.from_kc);
      const to = topicOf.get(link.to_kc);
      return from === undefined || to === undefined || from === to
        ? []
        : [`${from}>${to}`];
    }),
  );
  return [...edges].every((edge) => {
    const [from, to] = edge.split(">").map(Number) as [number, number];
    return from < to || edges.has(`${to}>${from}`);
  });
}

/** Prints the Topics for a human to judge. */
function print(topics: CourseTopic[]) {
  console.info("\nTopics in Course order:");
  for (const topic of topics) {
    const sections = topic.readingSections
      .map(
        (section) =>
          `${section.materialName} p. ${section.pageFrom}${section.pageTo > section.pageFrom ? `-${section.pageTo}` : ""}`,
      )
      .join("; ");
    console.info(
      `  ${topic.name}\n    question: ${topic.centralQuestion}\n    matters: ${topic.whyItMatters}\n    KCs: ${topic.kcs.map((kc) => kc.name).join("; ")}\n    anchors: ${topic.anchors.map((kc) => kc.name).join("; ") || "none"}\n    reading: ${sections || "none"}`,
    );
  }
}
