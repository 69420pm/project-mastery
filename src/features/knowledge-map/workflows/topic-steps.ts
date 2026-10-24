import "server-only";
import { loadCourseChunks } from "@/features/ingestion/server";
import {
  topicCall,
  topicSchema,
  type TopicCallInput,
} from "@/features/knowledge-map/ai/topic-calls";
import {
  checkTopicProposals,
  withTopicProposals,
  type Topic,
} from "@/features/knowledge-map/domain/topics";
import { aliases } from "@/features/knowledge-map/domain/update";
import {
  knowledgeMapSchema,
  type KnowledgeMap,
} from "@/features/knowledge-map/schemas";
import { loadStoredMap } from "@/features/knowledge-map/server/stored-map";
import { loadStoredTopics } from "@/features/knowledge-map/server/stored-topics";
import type { MapChunk } from "@/features/knowledge-map/types";
import {
  limitReached,
  mapCall,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The steps of the Topics stage of a Knowledge map build (#175), which runs
 * on the stored map after `storeMap`, on the admin client like the other
 * steps (`build-steps.ts`).
 */

/** What the Topics stage reads once, after the map is stored. */
export type TopicsInput = {
  studentId: string;
  /** The stored map, with stored row ids. */
  map: KnowledgeMap;
  topics: Topic[];
  /** The Course's chunks in Material order. */
  chunks: Array<Pick<MapChunk, "id" | "materialName" | "pageFrom">>;
};

/**
 * The owner, stored map, stored Topics and chunks of the Course whose build
 * runs. Null when no build runs any more.
 */
export async function loadTopicsInput(
  courseId: string,
): Promise<TopicsInput | null> {
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
  const [chunks, stored, topics] = await Promise.all([
    // Every chunk, for the order of Materials and pages.
    loadCourseChunks(supabase, courseId),
    loadStoredMap(supabase, courseId),
    loadStoredTopics(supabase, courseId),
  ]);
  return {
    studentId: data.owner,
    // Without what Priorities reads besides the map.
    map: knowledgeMapSchema.parse(stored),
    topics,
    chunks: chunks.map(({ id, materialName, pageFrom }) => ({
      id,
      materialName,
      pageFrom,
    })),
  };
}

/**
 * One Big idea (task `topic`): the model places its new KCs (`newKcIds`)
 * into its stored Topics or new ones, and code checks that every new KC is
 * placed once and keeps what is stored. Returns all Topics with this Big
 * idea's taken in. A failed check throws, so the step retries.
 */
export async function groupTopics(
  studentId: string,
  input: Omit<TopicsInput, "studentId">,
  bigIdeaId: string,
  newKcIds: string[],
): Promise<StepOutcome<Topic[]>> {
  "use step";
  const { map, topics } = input;
  const kcs = map.kcs.filter((kc) => kc.bigIdea === bigIdeaId);
  const stored = topics.filter(
    (topic): topic is Topic & { id: string } =>
      topic.bigIdea === bigIdeaId && topic.id !== null,
  );
  const kcIds = aliases(
    kcs.map((kc) => kc.id),
    "k",
  );
  const topicIds = aliases(
    stored.map((topic) => topic.id),
    "t",
  );
  const callInput = topicCallInput(input, bigIdeaId, newKcIds, {
    kc: kcIds.local,
    topic: topicIds.local,
  });
  const output = await mapCall(
    studentId,
    "map-topic",
    topicCall(callInput),
    "topic",
  );
  if (output === null) return limitReached;
  const proposals = topicSchema(callInput.kcs.map((kc) => kc.id))
    .parse(output)
    .topics.map((proposal) => ({
      ...proposal,
      id: topicIds.real(proposal.id),
      kcs: proposal.kcs.map(kcIds.real),
    }));
  checkTopicProposals(
    proposals,
    newKcIds,
    kcs.map((kc) => kc.id),
  );
  return {
    ok: true,
    value: withTopicProposals(topics, bigIdeaId, proposals, newKcIds),
  };
}

/**
 * What the `topic` call is sent for a Big idea: its KCs, each with its first
 * source and whether it is new, the links among them and its stored Topics,
 * all by the `local` ids.
 */
function topicCallInput(
  { map, topics, chunks }: Omit<TopicsInput, "studentId">,
  bigIdeaId: string,
  newKcIds: string[],
  local: { kc: (id: string) => string; topic: (id: string) => string },
): TopicCallInput {
  const bigIdea = map.bigIdeas.find((item) => item.id === bigIdeaId);
  if (!bigIdea) throw new Error(`Unknown big idea ${bigIdeaId}.`);
  const kcs = map.kcs.filter((kc) => kc.bigIdea === bigIdeaId);
  const inBigIdea = new Set(kcs.map((kc) => kc.id));
  const among = (link: { from: string; to: string }) =>
    inBigIdea.has(link.from) && inBigIdea.has(link.to);
  // Chunks are in Material order, so the first one a KC cites is its first.
  const firstSource = (sources: string[]) => {
    const first = chunks.find((chunk) => sources.includes(chunk.id));
    return first ? `${first.materialName} p. ${first.pageFrom}` : null;
  };
  const isNew = new Set(newKcIds);
  return {
    bigIdeaToGroup: { name: bigIdea.name, description: bigIdea.description },
    kcs: kcs.map((kc) => ({
      id: local.kc(kc.id),
      name: kc.name,
      type: kc.type,
      description: kc.description,
      firstSource: firstSource(kc.sources),
      status: isNew.has(kc.id) ? "new" : "placed",
    })),
    prerequisites: map.prerequisites.filter(among).map((link) => ({
      from: local.kc(link.from),
      to: local.kc(link.to),
    })),
    semanticLinks: map.semanticLinks.filter(among).map((link) => ({
      from: local.kc(link.from),
      to: local.kc(link.to),
      label: link.label,
    })),
    storedTopics: topics
      .filter((topic) => topic.bigIdea === bigIdeaId && topic.id !== null)
      .map((topic) => ({
        id: local.topic(topic.id ?? ""),
        name: topic.name,
        centralQuestion: topic.centralQuestion,
        kcs: topic.kcs.map(local.kc),
      })),
  };
}

/**
 * Makes the stored Topics these, in order, and marks the build built, in one
 * transaction. Stored Topics keep their ids. Does nothing when no build runs
 * any more.
 */
export async function storeTopics(
  courseId: string,
  topics: Topic[],
): Promise<void> {
  "use step";
  const { error } = await createAdminClient().rpc("replace_topics", {
    p_course_id: courseId,
    p_topics: topics,
  });
  if (error) failed("Storing the topics", error);
}
