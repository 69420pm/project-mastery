import "server-only";
import {
  kcMergeMessages,
  kcMergeSchema,
  kcMergeSettings,
  type OfferedCluster,
} from "@/features/knowledge-map/ai/kc-merge";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  clusterKcs,
  cosineSimilarity,
  MAX_CLUSTER_SIZE,
  mergeTargets,
  REVIVE_SIMILARITY,
  SAME_KC_SIMILARITY,
  type AlikePair,
  type ClusterKc,
} from "@/features/knowledge-map/domain/kc-clusters";
import { exerciseDifficulty } from "@/features/knowledge-map/domain/exercise-extraction";
import { acyclicLinks } from "@/features/knowledge-map/domain/prerequisite-cycles";
import {
  storedExtractionSchema,
  type ExtractedExercise,
  type StoredExtraction,
} from "@/features/knowledge-map/schemas";
import {
  loadCurrentExtractions,
  runCalls,
  stepOutcome,
  touchBuild,
  UNITS_PER_STEP,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  buildCall,
  RateLimited,
} from "@/features/knowledge-map/workflows/build-call";
import {
  meteredEmbed,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The consolidation steps of a build: the KCs of stored unit extractions
 * become stored KCs. Each new KC gets its vector; one within
 * REVIVE_SIMILARITY of a retired KC revives it, and one within
 * SAME_KC_SIMILARITY of another KC forms a cluster, about which a merge call
 * (task `map`, 15 clusters per call) says which KCs are the same. A merged
 * new KC is never stored: the KC it merges into gains its sources. An
 * exercise unit's extraction also stores its Exercises, in place by their
 * question chunks.
 */

/** The most clusters one merge call is asked about. */
const CLUSTERS_PER_CALL = 15;

/** Parallel `match_kcs` calls. */
const MATCHES_AT_ONCE = 10;

/** A unit extraction not stored as KCs yet, with its unit's key. */
type Pending = {
  extractionId: string;
  key: string;
  extraction: StoredExtraction;
};

/** A new KC of the step, by key: `<unit index>:<kc index>`. */
type FreshKc = {
  key: string;
  part: number;
  kc: StoredExtraction["kcs"][number] & { embedding: number[] };
};

/** A stored KC's key in clusters. */
const storedKey = (id: string) => `kc:${id}`;

/**
 * Stores the KCs of up to UNITS_PER_STEP pending unit extractions, in
 * Course order. Merge calls that fail, or that no longer fit the step,
 * hold back the units they concern for the next step; a unit held back by
 * a failed call that failed once before (`failedOnce`) fails the build. A
 * reached Daily limit stops the build.
 */
export async function consolidateKcs(
  courseId: string,
  failedOnce: readonly string[] = [],
): Promise<StepOutcome> {
  "use step";
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const pending = (await loadCurrentExtractions(supabase, courseId)).filter(
    (row) => row.kcIds === null,
  );
  if (pending.length === 0) return { ok: true, left: 0 };

  const batch: Pending[] = pending.slice(0, UNITS_PER_STEP).map((row) => ({
    extractionId: row.id,
    key: row.key,
    extraction: storedExtractionSchema.parse(row.output),
  }));
  if (!(await embedMissing(supabase, owner, batch))) {
    return { ok: false, reason: dailyLimitReason };
  }
  const fresh: FreshKc[] = batch.flatMap((part, p) =>
    part.extraction.kcs.map((kc, k) => ({
      key: `${p}:${k}`,
      part: p,
      kc: { ...kc, embedding: kc.embedding! },
    })),
  );

  const { revived, pairs } = await matchStored(supabase, courseId, fresh);
  const clusters = clusterKcs(pairs).filter((keys) =>
    keys.some((key) => !key.startsWith("kc:")),
  );
  const merged = await mergeClusters(
    supabase,
    owner,
    fresh,
    clusters,
    startedAt,
  );
  if (merged === "limit") return { ok: false, reason: dailyLimitReason };

  const ready = readyParts(batch.length, clusters, merged.decided);
  const stored = await storeKcs(supabase, courseId, {
    batch,
    fresh: fresh.filter((kc) => ready.has(kc.part)),
    ready,
    revived,
    targets: merged.targets,
  });
  if (!stored) return { ok: true, left: null };
  return stepOutcome(supabase, {
    left: pending.length - ready.size,
    failedKeys: [...merged.failed].flatMap((index) =>
      clusterParts(clusters[index]!).map((part) => batch[part]!.key),
    ),
    failedOnce,
    waitMs: merged.waitMs,
  });
}

/** The batch's units, by index, with new KCs in a cluster. */
const clusterParts = (keys: string[]) =>
  keys.flatMap((key) =>
    key.startsWith("kc:") ? [] : [Number(key.split(":")[0])],
  );

consolidateKcs.maxRetries = RATE_LIMITED_STEP_RETRIES;

/**
 * Embeds the batch's KCs without a vector in one call (task `embed`) and
 * stores the vectors with their extractions, so a later step does not pay
 * for them again. False when the Daily limit is reached.
 */
async function embedMissing(
  supabase: AdminSupabase,
  owner: string,
  batch: Pending[],
): Promise<boolean> {
  const missing = batch.flatMap((part) =>
    part.extraction.kcs.filter((kc) => !kc.embedding),
  );
  if (missing.length === 0) return true;
  const vectors = await meteredEmbed(
    supabase,
    { studentId: owner, traceName: "embed-kcs" },
    {
      values: missing.map((kc) => `${kc.name}: ${kc.description}`),
      asDocuments: true,
    },
    async (embeddings) => {
      missing.forEach((kc, index) => {
        kc.embedding = embeddings[index];
      });
      for (const part of batch) {
        const { error } = await supabase
          .from("chapter_extractions")
          .update({ output: part.extraction })
          .eq("id", part.extractionId);
        if (error) failed("Storing the KC vectors", error);
      }
    },
  );
  return vectors !== null;
}

type Match = { id: string; similarity: number };

/**
 * The Course's `count` live KCs, or with `retired` its retired ones,
 * nearest to `embedding` (a vector, or its text form), most alike first.
 */
export async function matchKcs(
  supabase: AdminSupabase,
  courseId: string,
  embedding: number[] | string,
  count: number,
  retired: boolean,
): Promise<Match[]> {
  const { data, error } = await supabase.rpc("match_kcs", {
    p_course_id: courseId,
    p_embedding:
      typeof embedding === "string" ? embedding : JSON.stringify(embedding),
    p_count: count,
    p_retired: retired,
  });
  if (error) failed("Matching the KCs", error);
  return data;
}

/**
 * The retired KC each new KC revives, and the pairs of alike KCs: a new KC
 * with its nearest stored KCs, and new KCs with each other.
 */
async function matchStored(
  supabase: AdminSupabase,
  courseId: string,
  fresh: FreshKc[],
): Promise<{ revived: Map<string, string>; pairs: AlikePair[] }> {
  const revived = new Map<string, string>();
  const pairs: AlikePair[] = [];
  for (let start = 0; start < fresh.length; start += MATCHES_AT_ONCE) {
    await Promise.all(
      fresh.slice(start, start + MATCHES_AT_ONCE).map(async ({ key, kc }) => {
        const [retired] = await matchKcs(
          supabase,
          courseId,
          kc.embedding,
          1,
          true,
        );
        if (retired && retired.similarity >= REVIVE_SIMILARITY) {
          revived.set(key, retired.id);
          return;
        }
        const live = await matchKcs(
          supabase,
          courseId,
          kc.embedding,
          MAX_CLUSTER_SIZE,
          false,
        );
        for (const match of live) {
          if (match.similarity >= SAME_KC_SIMILARITY) {
            pairs.push({
              a: key,
              b: storedKey(match.id),
              similarity: match.similarity,
            });
          }
        }
      }),
    );
  }
  const unrevived = fresh.filter(({ key }) => !revived.has(key));
  unrevived.forEach((a, i) => {
    for (const b of unrevived.slice(i + 1)) {
      const similarity = cosineSimilarity(a.kc.embedding, b.kc.embedding);
      if (similarity >= SAME_KC_SIMILARITY) {
        pairs.push({ a: a.key, b: b.key, similarity });
      }
    }
  });
  return { revived, pairs };
}

/**
 * Asks the merge calls (task `map`, trace `merge-kcs`) about the clusters
 * of new KCs by key, and of stored KCs keyed `kc:<id>`: the KC each merged
 * new KC becomes, by key, the indexes of the clusters decided and of those
 * whose call failed. `stepStartedAt` goes to `runCalls`. A call the rate
 * limit turned away leaves its clusters undecided, not failed, and starts
 * no further call: `waitMs` is the wait it named. "limit" when the Daily
 * limit is reached.
 */
async function mergeClusters(
  supabase: AdminSupabase,
  owner: string,
  fresh: ReadonlyArray<{
    key: string;
    kc: { name: string; description: string };
  }>,
  clusters: string[][],
  stepStartedAt: number,
): Promise<
  | {
      targets: Map<string, string>;
      decided: Set<number>;
      failed: Set<number>;
      waitMs?: number;
    }
  | "limit"
> {
  const targets = new Map<string, string>();
  const decided = new Set<number>();
  const failedCalls = new Set<number>();
  if (clusters.length === 0) return { targets, decided, failed: failedCalls };

  const storedIds = [
    ...new Set(
      clusters
        .flat()
        .flatMap((key) => (key.startsWith("kc:") ? [key.slice(3)] : [])),
    ),
  ];
  const storedKcs = new Map<
    string,
    { name: string; description: string; createdAt: string }
  >();
  if (storedIds.length > 0) {
    const { data, error } = await supabase
      .from("kcs")
      .select("id, name, description, created_at")
      .in("id", storedIds);
    if (error) failed("Loading the alike KCs", error);
    for (const kc of data) {
      storedKcs.set(storedKey(kc.id), {
        name: kc.name,
        description: kc.description,
        createdAt: kc.created_at,
      });
    }
  }
  const freshByKey = new Map(fresh.map((kc) => [kc.key, kc.kc]));
  const textOf = (key: string) => freshByKey.get(key) ?? storedKcs.get(key);
  const clusterKcsOf = (keys: string[]): ClusterKc[] =>
    keys.flatMap((key): ClusterKc[] => {
      if (!key.startsWith("kc:")) return [{ key, stored: false }];
      const kc = storedKcs.get(key);
      return kc ? [{ key, stored: true, createdAt: kc.createdAt }] : [];
    });

  const calls: number[][] = [];
  for (let start = 0; start < clusters.length; start += CLUSTERS_PER_CALL) {
    calls.push(
      clusters
        .slice(start, start + CLUSTERS_PER_CALL)
        .map((_, offset) => start + offset),
    );
  }
  let limitReached = false;
  let waitMs: number | undefined;
  await runCalls(
    calls,
    async (indexes) => {
      const keyOf = new Map<string, string>();
      const offered = indexes.map((index): OfferedCluster => ({
        kcs: clusterKcsOf(clusters[index]!).map(({ key }) => {
          const id = `k${keyOf.size + 1}`;
          keyOf.set(id, key);
          const { name, description } = textOf(key)!;
          return { id, name, description };
        }),
      }));
      const answer = await buildCall(
        supabase,
        { studentId: owner, task: "map", traceName: "merge-kcs" },
        { ...kcMergeSettings(offered), messages: kcMergeMessages(offered) },
        kcMergeSchema(),
      );
      if (answer === "limit") {
        limitReached = true;
        return "stop";
      }
      if (answer instanceof RateLimited) {
        waitMs = Math.max(waitMs ?? 0, answer.waitMs);
        return "stop";
      }
      if (answer === "failed") {
        for (const index of indexes) failedCalls.add(index);
        return;
      }
      const { same } = answer;
      const groups = same.map((group) =>
        group.kcIds.flatMap((id) => keyOf.get(id) ?? []),
      );
      for (const index of indexes) {
        for (const [key, target] of mergeTargets(
          clusterKcsOf(clusters[index]!),
          groups,
        )) {
          targets.set(key, target);
        }
        decided.add(index);
      }
    },
    stepStartedAt,
  );
  return limitReached
    ? "limit"
    : { targets, decided, failed: failedCalls, waitMs };
}

/**
 * The batch's units whose KCs are all decided: in no cluster, or in a
 * decided one whose other new KCs' units are ready too.
 */
function readyParts(
  partCount: number,
  clusters: string[][],
  decided: ReadonlySet<number>,
): Set<number> {
  const partsOf = clusterParts;
  const unready = new Set(
    clusters.flatMap((keys, index) =>
      decided.has(index) ? [] : partsOf(keys),
    ),
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const keys of clusters) {
      const members = partsOf(keys);
      if (
        members.some((part) => unready.has(part)) &&
        members.some((part) => !unready.has(part))
      ) {
        for (const part of members) unready.add(part);
        changed = true;
      }
    }
  }
  return new Set(
    Array.from({ length: partCount }, (_, part) => part).filter(
      (part) => !unready.has(part),
    ),
  );
}

/** A KC row of `store_chapter_kcs`. */
type StoredKcRow = {
  id: string;
  new: boolean;
  name?: string;
  description?: string;
  origin?: "content" | "exercise";
  embedding?: string;
  sources: string[];
};

/**
 * Stores the ready units' KCs, their sources and Prerequisites with
 * `store_chapter_kcs`. False when the build no longer runs.
 */
async function storeKcs(
  supabase: AdminSupabase,
  courseId: string,
  {
    batch,
    fresh,
    ready,
    revived,
    targets,
  }: {
    batch: Pending[];
    fresh: FreshKc[];
    ready: ReadonlySet<number>;
    revived: ReadonlyMap<string, string>;
    targets: ReadonlyMap<string, string>;
  },
): Promise<boolean> {
  const newIds = new Map<string, string>();
  const rows = new Map<string, StoredKcRow>();
  for (const { key, part, kc } of fresh) {
    if (revived.has(key) || targets.has(key)) continue;
    const id = crypto.randomUUID();
    newIds.set(key, id);
    rows.set(id, {
      id,
      new: true,
      name: kc.name,
      description: kc.description,
      origin: batch[part]!.extraction.exercises ? "exercise" : "content",
      embedding: JSON.stringify(kc.embedding),
      sources: [],
    });
  }
  const idOf = (key: string): string => {
    const target = revived.get(key) ?? targets.get(key) ?? key;
    return target.startsWith("kc:")
      ? target.slice(3)
      : (newIds.get(target) ?? target);
  };
  for (const { key, kc } of fresh) {
    const id = idOf(key);
    const row = rows.get(id) ?? { id, new: false, sources: [] };
    row.sources.push(...kc.chunkIds);
    rows.set(id, row);
  }

  const readyParts = [...ready].map((part) => ({ part, ...batch[part]! }));
  const links = readyParts.flatMap(({ part, extraction }) =>
    extraction.prerequisites.map((link) => ({
      from: idOf(`${part}:${link.from}`),
      to: idOf(`${part}:${link.to}`),
    })),
  );
  const storedLinks = await supabase
    .from("prerequisite_links")
    .select("from_kc, to_kc")
    .eq("course_id", courseId);
  if (storedLinks.error) {
    failed("Loading the Prerequisites", storedLinks.error);
  }

  const { data, error } = await supabase.rpc("store_chapter_kcs", {
    p_course_id: courseId,
    p_kcs: [...rows.values()],
    p_prerequisites: acyclicLinks(
      storedLinks.data.map((link) => ({ from: link.from_kc, to: link.to_kc })),
      links,
    ),
    p_units: readyParts.map(({ part, extractionId, extraction }) => ({
      extractionId,
      kcIds: extraction.kcs.map((_, k) => idOf(`${part}:${k}`)),
      ...(extraction.exercises && {
        chunkIds: extraction.exercises.map((exercise) => exercise.chunkId),
        exercises: storedExercises(extraction.exercises, (k) =>
          idOf(`${part}:${k}`),
        ),
      }),
    })),
  });
  if (error) failed("Storing the KCs", error);
  return data;
}

/**
 * The Exercises of an exercise unit's extraction as `store_chapter_kcs`
 * takes them: its new KCs by their stored ids, and its difficulty.
 */
function storedExercises(
  exercises: ExtractedExercise[],
  newKcId: (index: number) => string,
) {
  return exercises
    .filter((exercise) => !exercise.notAnExercise)
    .map((exercise) => {
      const kcIds = [
        ...new Set([...exercise.kcIds, ...exercise.newKcs.map(newKcId)]),
      ];
      return {
        questionChunkId: exercise.chunkId,
        solutionChunkId: exercise.solutionChunkId,
        kcIds,
        finalAnswers: exercise.finalAnswers,
        difficulty: exerciseDifficulty(kcIds.length, exercise.solutionLines),
      };
    });
}
