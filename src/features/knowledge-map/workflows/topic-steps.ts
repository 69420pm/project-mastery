import "server-only";
import { createHash } from "node:crypto";
import {
  topicTreeMessages,
  topicTreeSchema,
  topicTreeSettings,
  type OfferedCourse,
} from "@/features/knowledge-map/ai/topic-tree";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  kcChapters,
  storedAsProposed,
  type ProposedTopic,
  type StoredTreeTopic,
  type TreeKc,
} from "@/features/knowledge-map/domain/topic-tree";
import {
  loadCourseLanguage,
  touchBuild,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  buildCall,
  RateLimited,
} from "@/features/knowledge-map/workflows/build-call";
import {
  firstSourcePlaces,
  loadMapInput,
  type MapInput,
} from "@/features/knowledge-map/workflows/map-input";
import { RATE_LIMITED_STEP_RETRIES } from "@/features/usage/server";
import { retryTimeoutMs } from "@/lib/ai/call-timeout";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The Topic tree step of a build (#229): one `topic` call per build that
 * groups the Course's Chapters with KCs into nested Topics, made only when
 * what the tree is built from changed since the stored tree.
 */

/** What the tree step gives the last step. */
export type TreeProposal = {
  /** The hash of what the tree is built from; null when no call answered. */
  hash: string | null;
  /** The call's Topics; null to keep the stored tree. */
  topics: ProposedTopic[] | null;
};

export type TreeOutcome =
  { ok: true; tree: TreeProposal | null } | { ok: false; reason: string };

/**
 * The live KCs as the tree places them, in Course order, with their
 * embeddings when `vectors` has them.
 */
export function treeKcs(
  input: MapInput,
  vectors: ReadonlyMap<string, number[]> = new Map(),
): TreeKc[] {
  const places = firstSourcePlaces(input);
  return input.kcs
    .filter((kc) => places.has(kc.id))
    .toSorted((a, b) => places.get(a.id)! - places.get(b.id)!)
    .map((kc) => {
      const chapterId = input.chunks[places.get(kc.id)!]!.chapterId;
      const vector = vectors.get(kc.id);
      const base = { id: kc.id, chapterId, ...(vector && { vector }) };
      if (kc.origin !== "exercise") return base;
      return {
        ...base,
        tests: input.exercises
          .filter((kcs) => kcs.includes(kc.id))
          .flatMap((kcs) => kcs.filter((id) => id !== kc.id)),
      };
    });
}

/** The embeddings of the Course's live KCs, by KC id. */
export async function loadKcVectors(
  supabase: AdminSupabase,
  courseId: string,
): Promise<Map<string, number[]>> {
  const rows = await allRows("Loading the KC embeddings", (from, to) =>
    supabase
      .from("kcs")
      .select("id, embedding")
      .eq("course_id", courseId)
      .is("retired_at", null)
      .not("embedding", "is", null)
      .order("id")
      .range(from, to),
  );
  return new Map(
    rows.flatMap((row) => {
      // PostgREST returns a vector as its text, `[0.1,0.2]`.
      const vector: unknown =
        typeof row.embedding === "string"
          ? JSON.parse(row.embedding)
          : row.embedding;
      return Array.isArray(vector)
        ? [[row.id, vector as number[]] as const]
        : [];
    }),
  );
}

/** The Course's stored Topics in tree order. */
export async function loadStoredTree(
  supabase: AdminSupabase,
  courseId: string,
): Promise<StoredTreeTopic[]> {
  const rows = await allRows("Loading the Topics", (from, to) =>
    supabase
      .from("topics")
      .select("id, parent_id, name, central_question, chapter_ids")
      .eq("course_id", courseId)
      .order("position")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    centralQuestion: row.central_question,
    chapterIds: row.chapter_ids,
  }));
}

/**
 * What the tree call gets, with short ids for the Chapters (`c1…`) and the
 * stored Topics (`t1…`), and the hash of its Outlines and KCs, which leaves
 * out the stored tree so a build after a call makes none.
 */
function offeredCourse(
  input: MapInput,
  stored: StoredTreeTopic[],
  language: string,
) {
  const kcName = new Map(input.kcs.map((kc) => [kc.id, kc.name]));
  const namesOf = Map.groupBy(
    [...kcChapters(treeKcs(input))],
    ([, chapterId]) => chapterId,
  );
  const chapterIds = new Map(
    input.chapters.map((chapter, index) => [chapter.id, `c${index + 1}`]),
  );
  const materials = input.materials.map((material) => ({
    name: material.name,
    outline: input.chapters
      .filter((chapter) => chapter.materialId === material.id)
      .map((chapter) => {
        const kcs = namesOf.get(chapter.id)?.map(([id]) => kcName.get(id)!);
        return {
          id: chapterIds.get(chapter.id)!,
          title: chapter.title,
          depth: chapter.depth,
          ...(kcs && { kcs }),
        };
      }),
  }));
  const hash = createHash("sha256")
    .update(JSON.stringify({ language, materials }))
    .digest("hex");
  const topicIds = new Map(
    stored.map((topic, index) => [topic.id, `t${index + 1}`]),
  );
  const levels = storedAsProposed(stored);
  const course: OfferedCourse = {
    language,
    materials,
    storedTopics: stored.map((topic, index) => ({
      id: topicIds.get(topic.id)!,
      name: topic.name,
      level: levels[index]!.level,
      chapters: topic.chapterIds.flatMap((id) => chapterIds.get(id) ?? []),
    })),
  };
  return { course, hash, chapterIds, topicIds };
}

/**
 * Proposes the Topic tree: no call when the Course has no KCs, or when its
 * Outlines and KCs are what the stored tree was built from; else one call,
 * its short ids turned back into stored ones (unknown ones are dropped). A
 * call that fails is made once more; when that fails too, the proposal is
 * empty, so every Chapter with KCs becomes a Topic of its own, and the
 * build goes on. A reached Daily limit stops the build; the rate limit
 * retries the step after its wait.
 */
export async function proposeTopicTree(courseId: string): Promise<TreeOutcome> {
  "use step";
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, tree: null };

  const [input, stored, build, language] = await Promise.all([
    loadMapInput(supabase, courseId),
    loadStoredTree(supabase, courseId),
    supabase
      .from("knowledge_map_builds")
      .select("topic_tree_hash")
      .eq("course_id", courseId)
      .single(),
    loadCourseLanguage(supabase, courseId),
  ]);
  if (build.error) failed("Loading the build", build.error);
  const { course, hash, chapterIds, topicIds } = offeredCourse(
    input,
    stored,
    language,
  );
  if (input.kcs.length === 0) return { ok: true, tree: { hash, topics: [] } };
  if (hash === build.data.topic_tree_hash) {
    return { ok: true, tree: { hash, topics: null } };
  }

  const treeCall = (timeoutMs?: number) =>
    buildCall(
      supabase,
      { studentId: owner, task: "topic", traceName: "topic-tree" },
      { ...topicTreeSettings(course), messages: topicTreeMessages(course) },
      topicTreeSchema(),
      timeoutMs,
    );
  let answer = await treeCall();
  const retryMs = retryTimeoutMs(startedAt);
  if (answer === "failed" && retryMs !== null) answer = await treeCall(retryMs);
  // The step's one call: the step is retried after the wait.
  if (answer instanceof RateLimited) throw answer.error;
  if (answer === "limit") return { ok: false, reason: dailyLimitReason };
  if (answer === "failed") {
    // Each Chapter with KCs becomes a Topic of its own (`planTopicTree`);
    // without a hash, the next Update map calls again.
    return { ok: true, tree: { hash: null, topics: [] } };
  }
  const chapterOf = new Map([...chapterIds].map(([id, short]) => [short, id]));
  const topicOf = new Map([...topicIds].map(([id, short]) => [short, id]));
  return {
    ok: true,
    tree: {
      hash,
      topics: answer.topics.map((topic) => ({
        level: topic.level,
        name: topic.name,
        chapterIds: topic.chapterIds.flatMap((id) => chapterOf.get(id) ?? []),
        centralQuestion: topic.centralQuestion,
        continues: topicOf.get(topic.continues) ?? null,
      })),
    },
  };
}

proposeTopicTree.maxRetries = RATE_LIMITED_STEP_RETRIES;
