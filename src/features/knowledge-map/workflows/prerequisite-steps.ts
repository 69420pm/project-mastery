import "server-only";
import {
  prerequisiteCheckMessages,
  prerequisiteCheckSchema,
  prerequisiteCheckSettings,
  type OfferedKc,
  type OfferedName,
} from "@/features/knowledge-map/ai/prerequisite-check";
import { dailyLimitReason } from "@/features/knowledge-map/domain/build-failure";
import {
  clusterKcs,
  cosineSimilarity,
  REVIVE_SIMILARITY,
  SAME_KC_SIMILARITY,
  type AlikePair,
} from "@/features/knowledge-map/domain/kc-clusters";
import {
  acyclicLinks,
  type Link,
} from "@/features/knowledge-map/domain/prerequisite-cycles";
import { storedExtractionSchema } from "@/features/knowledge-map/schemas";
import {
  buildCall,
  loadCurrentExtractions,
  runCalls,
  touchBuild,
  UNITS_PER_STEP,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import {
  matchKcs,
  mergeClusters,
} from "@/features/knowledge-map/workflows/consolidate-steps";
import {
  kcPlaces,
  loadMapInput,
} from "@/features/knowledge-map/workflows/map-input";
import {
  meteredEmbed,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The Prerequisite check of a build (#236): what each stored KC `assumes`
 * becomes. Each name is embedded as "name: description" and offered with
 * the 5 nearest live KCs other than the assuming KC; one call (task `map`)
 * per 25 names picks the KC each means, or none. An earlier KC becomes a
 * Prerequisite, a later one nothing, and none (or no candidates) a new KC
 * without sources that the assuming KC builds on: it revives a retired KC
 * as alike as consolidation asks, and the step's new KCs are made unique,
 * by name and through the merge call.
 */

/** The most names one check call is asked about. */
const NAMES_PER_CALL = 25;
/** The KCs a name is offered. */
const CANDIDATES = 5;
/** Parallel `match_kcs` calls. */
const MATCHES_AT_ONCE = 10;

/** A name a stored KC assumes, by the batch's unit index, with its vector. */
type Assumed = {
  part: number;
  kcId: string;
  name: string;
  description: string;
  embedding: number[];
};

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Matches what the KCs of up to UNITS_PER_STEP stored unit extractions
 * assume, in Course order, and stores the new KCs, the Prerequisites and
 * the extractions marked matched in one transaction. Units whose calls the
 * call window leaves out wait for the next step. A reached Daily limit
 * stops the build.
 */
export async function matchAssumptions(courseId: string): Promise<StepOutcome> {
  "use step";
  const since = Date.now();
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const pending = (await loadCurrentExtractions(supabase, courseId)).filter(
    (row) => row.kcIds !== null && !row.assumesMatched,
  );
  if (pending.length === 0) return { ok: true, left: 0 };

  const batch = pending.slice(0, UNITS_PER_STEP);
  const named = batch.flatMap((row, part) =>
    storedExtractionSchema.parse(row.output).kcs.flatMap((kc, k) =>
      kc.assumes.map((assumed) => ({
        part,
        kcId: row.kcIds![k]!,
        ...assumed,
      })),
    ),
  );
  const assumed = await embedNames(supabase, owner, named);
  if (assumed === "limit") return { ok: false, reason: dailyLimitReason };

  const checked = await checkNames(supabase, owner, courseId, assumed);
  const unready = checked.unready;
  const unique = await uniqueKcs(
    supabase,
    owner,
    courseId,
    checked.fresh.filter((item) => !unready.has(item.part)),
    since,
  );
  if (unique === "limit") return { ok: false, reason: dailyLimitReason };
  for (const part of unique.unready) unready.add(part);

  const links = [...checked.links, ...unique.links].filter(
    (link) => !unready.has(link.part),
  );
  const ready = batch.flatMap((row, part) =>
    unready.has(part) ? [] : [row.id],
  );
  const stored = await supabase
    .from("prerequisite_links")
    .select("from_kc, to_kc")
    .eq("course_id", courseId);
  if (stored.error) failed("Loading the Prerequisites", stored.error);
  const used = new Set(links.map((link) => link.from));
  const { data, error } = await supabase.rpc("store_assumed_prerequisites", {
    p_course_id: courseId,
    p_kcs: unique.kcs.filter((kc) => used.has(kc.id)),
    p_prerequisites: acyclicLinks(
      stored.data.map((link) => ({ from: link.from_kc, to: link.to_kc })),
      links.map(({ from, to }) => ({ from, to })),
    ),
    p_extraction_ids: ready,
  });
  if (error) failed("Storing the assumed Prerequisites", error);
  if (!data) return { ok: true, left: null };
  if (checked.limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: pending.length - ready.length };
}

matchAssumptions.maxRetries = RATE_LIMITED_STEP_RETRIES;

/**
 * The names with their vectors of "name: description", from one call
 * (task `embed`). "limit" when the Daily limit is reached.
 */
async function embedNames(
  supabase: AdminSupabase,
  owner: string,
  named: Array<Omit<Assumed, "embedding">>,
): Promise<Assumed[] | "limit"> {
  if (named.length === 0) return [];
  const textOf = (item: Omit<Assumed, "embedding">) =>
    `${item.name}: ${item.description}`;
  const texts = [...new Set(named.map(textOf))];
  const vectors = await meteredEmbed(
    supabase,
    { studentId: owner, traceName: "embed-assumed" },
    { values: texts, asDocuments: true },
  );
  if (!vectors) return "limit";
  return named.map((item) => ({
    ...item,
    embedding: vectors[texts.indexOf(textOf(item))]!,
  }));
}

/** The assumed name each offered name stands for, by object. */
const assumedOf = new WeakMap<OfferedName, Assumed>();
/** The stored KC id each offered candidate stands for, by object. */
const kcIdOf = new WeakMap<OfferedKc, string>();

/**
 * Offers each name its candidates and asks the check calls: the
 * Prerequisites on earlier KCs, the names that become new KCs, the units
 * whose calls the call window or the Daily limit left out, and whether
 * the limit was reached.
 */
async function checkNames(
  supabase: AdminSupabase,
  owner: string,
  courseId: string,
  assumed: Assumed[],
): Promise<{
  links: Array<Link & { part: number }>;
  fresh: Assumed[];
  unready: Set<number>;
  limitReached: boolean;
}> {
  const map = await loadMapInput(supabase, courseId);
  const places = kcPlaces(map);
  const kcs = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const nearest: string[][] = [];
  for (let start = 0; start < assumed.length; start += MATCHES_AT_ONCE) {
    nearest.push(
      ...(await Promise.all(
        assumed.slice(start, start + MATCHES_AT_ONCE).map(async (item) =>
          (
            await matchKcs(
              supabase,
              courseId,
              item.embedding,
              CANDIDATES + 1,
              false,
            )
          )
            .map(({ id }) => id)
            .filter((id) => id !== item.kcId && kcs.has(id))
            .slice(0, CANDIDATES),
        ),
      )),
    );
  }

  const fresh: Assumed[] = [];
  const offered: OfferedName[] = [];
  assumed.forEach((item, index) => {
    const user = kcs.get(item.kcId);
    if (!user) return;
    const ids = nearest[index]!;
    if (ids.length === 0) {
      fresh.push(item);
      return;
    }
    const n = offered.length + 1;
    const name: OfferedName = {
      id: `n${n}`,
      name: item.name,
      description: item.description,
      usedBy: `${user.name}: ${user.description}`,
      candidates: ids.map((id, k): OfferedKc => {
        const kc = kcs.get(id)!;
        const candidate = {
          id: `n${n}k${k + 1}`,
          name: kc.name,
          description: kc.description,
        };
        kcIdOf.set(candidate, id);
        return candidate;
      }) as [OfferedKc, ...OfferedKc[]],
    };
    assumedOf.set(name, item);
    offered.push(name);
  });

  const calls: OfferedName[][] = [];
  for (let start = 0; start < offered.length; start += NAMES_PER_CALL) {
    calls.push(offered.slice(start, start + NAMES_PER_CALL));
  }
  const done = new Set<OfferedName[]>();
  const links: Array<Link & { part: number }> = [];
  let limitReached = false;
  await runCalls(calls, async (names) => {
    const answer = await buildCall(
      supabase,
      { studentId: owner, task: "map", traceName: "check-prerequisites" },
      {
        ...prerequisiteCheckSettings(names),
        messages: prerequisiteCheckMessages(names),
      },
      prerequisiteCheckSchema(names),
    );
    if (answer === "limit") {
      limitReached = true;
      return "stop";
    }
    for (const name of names) {
      const item = assumedOf.get(name)!;
      const meant = name.candidates.find(
        (kc) => kc.id === answer.meanings[name.id],
      );
      if (!meant) {
        fresh.push(item);
        continue;
      }
      // A KC the Course teaches later would be a forward link: none.
      const from = kcIdOf.get(meant)!;
      const place = places.get(item.kcId) ?? Infinity;
      if ((places.get(from) ?? Infinity) < place) {
        links.push({ part: item.part, from, to: item.kcId });
      }
    }
    done.add(names);
  });

  const unready = new Set(
    calls
      .filter((names) => !done.has(names))
      .flatMap((names) => names.map((name) => assumedOf.get(name)!.part)),
  );
  return { links, fresh, unready, limitReached };
}

/** A KC row of `store_assumed_prerequisites`: new, or a retired one revived. */
type AssumedKcRow =
  | {
      id: string;
      new: true;
      name: string;
      description: string;
      embedding: string;
    }
  | { id: string; new: false };

/**
 * The KCs the names that the check left over become: one per name (by
 * key), a retired KC within REVIVE_SIMILARITY revived instead, and those
 * within SAME_KC_SIMILARITY of each other merged as the merge call says.
 * Returns the KC rows, the links from them to the KCs that assume them,
 * and the units whose merge call the call window left out. "limit" when
 * the Daily limit is reached.
 */
async function uniqueKcs(
  supabase: AdminSupabase,
  owner: string,
  courseId: string,
  fresh: Assumed[],
  since: number,
): Promise<
  | {
      kcs: AssumedKcRow[];
      links: Array<Link & { part: number }>;
      unready: Set<number>;
    }
  | "limit"
> {
  const groups = [...Map.groupBy(fresh, (item) => nameKey(item.name))].map(
    ([, items], index) => ({ key: `name:${index}`, items, kc: items[0]! }),
  );
  const revived = new Map<string, string>();
  for (let start = 0; start < groups.length; start += MATCHES_AT_ONCE) {
    await Promise.all(
      groups.slice(start, start + MATCHES_AT_ONCE).map(async (group) => {
        const [retired] = await matchKcs(
          supabase,
          courseId,
          group.kc.embedding,
          1,
          true,
        );
        if (retired && retired.similarity >= REVIVE_SIMILARITY) {
          revived.set(group.key, retired.id);
        }
      }),
    );
  }

  const unrevived = groups.filter((group) => !revived.has(group.key));
  const pairs: AlikePair[] = [];
  unrevived.forEach((a, i) => {
    for (const b of unrevived.slice(i + 1)) {
      const similarity = cosineSimilarity(a.kc.embedding, b.kc.embedding);
      if (similarity >= SAME_KC_SIMILARITY) {
        pairs.push({ a: a.key, b: b.key, similarity });
      }
    }
  });
  const clusters = clusterKcs(pairs);
  const merged = await mergeClusters(
    supabase,
    owner,
    unrevived,
    clusters,
    since,
  );
  if (merged === "limit") return "limit";

  const undecided = new Set(
    clusters.flatMap((keys, index) => (merged.decided.has(index) ? [] : keys)),
  );
  const unready = new Set(
    groups.flatMap((group) =>
      undecided.has(group.key) ? group.items.map((item) => item.part) : [],
    ),
  );
  const ids = new Map<string, string>();
  const kcs: AssumedKcRow[] = [];
  for (const group of groups) {
    const id = revived.get(group.key) ?? crypto.randomUUID();
    ids.set(group.key, id);
    if (revived.has(group.key)) {
      kcs.push({ id, new: false });
    } else if (!merged.targets.has(group.key)) {
      kcs.push({
        id,
        new: true,
        name: group.kc.name,
        description: group.kc.description,
        embedding: JSON.stringify(group.kc.embedding),
      });
    }
  }
  const idOf = (key: string) => ids.get(merged.targets.get(key) ?? key)!;
  const links = groups.flatMap((group) =>
    group.items.map((item) => ({
      part: item.part,
      from: idOf(group.key),
      to: item.kcId,
    })),
  );
  return { kcs, links, unready };
}
