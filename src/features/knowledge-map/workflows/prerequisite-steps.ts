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
  acyclicLinks,
  type Link,
} from "@/features/knowledge-map/domain/prerequisite-cycles";
import {
  kcAssumesSchema,
  storedExtractionSchema,
} from "@/features/knowledge-map/schemas";
import {
  buildCall,
  loadCurrentExtractions,
  runCalls,
  stepOutcome,
  touchBuild,
  UNITS_PER_STEP,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { matchKcs } from "@/features/knowledge-map/workflows/consolidate-steps";
import {
  firstSourcePlaces,
  loadMapInput,
} from "@/features/knowledge-map/workflows/map-input";
import {
  meteredEmbed,
  RATE_LIMITED_STEP_RETRIES,
} from "@/features/usage/server";
import { allRows } from "@/lib/supabase/all-rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { AdminSupabase } from "@/lib/supabase/types";

/**
 * The Prerequisite check of a build (#236, #249): what each stored KC
 * `assumes` becomes. Each name is embedded as "name: description" and
 * offered with the 5 nearest live KCs other than the assuming KC; one call
 * (task `map`) per 25 names picks the KC each means, or none. An earlier
 * KC becomes a Prerequisite and a later one nothing. What no KC means
 * stays on the assuming KC as text (`kcs.assumes`), and is matched again
 * when a later build stores KCs near it.
 */

/** The most names one check call is asked about. */
const NAMES_PER_CALL = 25;
/** The KCs a name is offered. */
const CANDIDATES = 5;
/** Parallel `match_kcs` calls. */
const MATCHES_AT_ONCE = 10;
/** The most stored names one step matches again. */
const NAMES_PER_STEP = 100;

/** A name a KC assumes, with its vector. */
type Assumed = {
  kcId: string;
  name: string;
  description: string;
  embedding: number[];
};

/** What the check made of a name: the earlier KC it means, a later one, or none. */
type Meaning = { from: string } | "later" | "none";

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Matches what the KCs of up to UNITS_PER_STEP stored unit extractions
 * assume, in Course order, and stores the Prerequisites, the names no KC
 * means as text on their KCs and the extractions marked matched in one
 * transaction. Units whose calls fail or no longer fit the step wait for
 * the next step; one held back by a failed call that failed once before
 * (`failedOnce`) fails the build. A reached Daily limit stops the build.
 */
export async function matchAssumptions(
  courseId: string,
  failedOnce: readonly string[] = [],
): Promise<StepOutcome> {
  "use step";
  const startedAt = Date.now();
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

  const checked = await checkNames(
    supabase,
    owner,
    courseId,
    assumed,
    startedAt,
  );
  const partsOf = (indexes: Set<number>) =>
    new Set([...indexes].map((index) => named[index]!.part));
  const unready = partsOf(new Set([...checked.unasked, ...checked.failed]));
  const answered = [...checked.meanings].filter(
    ([index]) => !unready.has(named[index]!.part),
  );
  const ready = batch.flatMap((row, part) =>
    unready.has(part) ? [] : [row.id],
  );
  const { data, error } = await supabase.rpc("store_assumed_prerequisites", {
    p_course_id: courseId,
    p_prerequisites: await acyclicWithStored(
      supabase,
      courseId,
      linksOf(answered, assumed),
    ),
    p_assumes: answered.flatMap(([index, meaning]) => {
      const { kcId, name, description } = assumed[index]!;
      return meaning === "none" ? [{ kc: kcId, name, description }] : [];
    }),
    p_matched: [],
    p_extraction_ids: ready,
  });
  if (error) failed("Storing the assumed Prerequisites", error);
  if (!data) return { ok: true, left: null };
  if (checked.limitReached) return { ok: false, reason: dailyLimitReason };
  return stepOutcome(supabase, {
    left: pending.length - ready.length,
    failedKeys: [...partsOf(checked.failed)].map((part) => batch[part]!.key),
    failedOnce,
  });
}

matchAssumptions.maxRetries = RATE_LIMITED_STEP_RETRIES;

/**
 * What a step that matches stored names again did: how many names it
 * left, or null when the build no longer runs, and the key of the last
 * name it handled, which the next step starts after; or why the build
 * stops.
 */
export type RematchOutcome =
  | { ok: true; left: number | null; after: string }
  | { ok: false; reason: string };

/**
 * Matches again the names live KCs assume as text (`kcs.assumes`) whose 5
 * nearest live KCs include one this build stored, up to NAMES_PER_STEP
 * names after the key `after` (`<kc id>/<name>`, in key order). A name the
 * check matches leaves the KC's text, and becomes a Prerequisite when it
 * means an earlier KC. A name whose call fails stays as it is. Calls that
 * no longer fit the step are left to the next step. A reached Daily limit
 * stops the build.
 */
export async function rematchAssumptions(
  courseId: string,
  after: string,
): Promise<RematchOutcome> {
  "use step";
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null, after };

  const [build, kcs] = await Promise.all([
    supabase
      .from("knowledge_map_builds")
      .select("started_at")
      .eq("course_id", courseId)
      .single(),
    allRows("Loading the KCs", (from, to) =>
      supabase
        .from("kcs")
        .select("id, assumes, created_at")
        .eq("course_id", courseId)
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (build.error) failed("Loading the build", build.error);
  const buildStart = Date.parse(build.data.started_at);
  const stored = new Set(
    kcs.flatMap((kc) =>
      Date.parse(kc.created_at) >= buildStart ? [kc.id] : [],
    ),
  );
  const names = kcs
    .flatMap((kc) =>
      kcAssumesSchema.parse(kc.assumes).map((assumed) => ({
        key: `${kc.id}/${nameKey(assumed.name)}`,
        kcId: kc.id,
        ...assumed,
      })),
    )
    .filter((name) => name.key > after)
    .toSorted((a, b) => (a.key < b.key ? -1 : 1));
  if (stored.size === 0 || names.length === 0) {
    return { ok: true, left: 0, after };
  }

  const batch = names.slice(0, NAMES_PER_STEP);
  const assumed = await embedNames(supabase, owner, batch);
  if (assumed === "limit") return { ok: false, reason: dailyLimitReason };
  const checked = await checkNames(
    supabase,
    owner,
    courseId,
    assumed,
    startedAt,
    (candidates) => candidates.some((id) => stored.has(id)),
  );
  const matched = [...checked.meanings].filter(
    ([, meaning]) => meaning !== "none",
  );
  const { data, error } = await supabase.rpc("store_assumed_prerequisites", {
    p_course_id: courseId,
    p_prerequisites: await acyclicWithStored(
      supabase,
      courseId,
      linksOf(matched, assumed),
    ),
    p_assumes: [],
    p_matched: matched.map(([index]) => ({
      kc: assumed[index]!.kcId,
      name: assumed[index]!.name,
    })),
    p_extraction_ids: [],
  });
  if (error) failed("Storing the names matched again", error);
  if (!data) return { ok: true, left: null, after };
  if (checked.limitReached) return { ok: false, reason: dailyLimitReason };

  // The names up to the first one whose call never started are done.
  const done = [...checked.unasked].reduce(
    (first, index) => Math.min(first, index),
    batch.length,
  );
  return {
    ok: true,
    left: names.length - done,
    after: done === 0 ? after : batch[done - 1]!.key,
  };
}

rematchAssumptions.maxRetries = RATE_LIMITED_STEP_RETRIES;

/** The Prerequisites of the names that mean an earlier KC. */
function linksOf(
  meanings: ReadonlyArray<readonly [number, Meaning]>,
  assumed: readonly Assumed[],
): Link[] {
  return meanings.flatMap(([index, meaning]) =>
    typeof meaning === "object"
      ? [{ from: meaning.from, to: assumed[index]!.kcId }]
      : [],
  );
}

/** `links` without those that would close a cycle with the stored ones. */
async function acyclicWithStored(
  supabase: AdminSupabase,
  courseId: string,
  links: Link[],
): Promise<Link[]> {
  if (links.length === 0) return [];
  const stored = await supabase
    .from("prerequisite_links")
    .select("from_kc, to_kc")
    .eq("course_id", courseId);
  if (stored.error) failed("Loading the Prerequisites", stored.error);
  return acyclicLinks(
    stored.data.map((link) => ({ from: link.from_kc, to: link.to_kc })),
    links,
  );
}

/**
 * The names with their vectors of "name: description", from one call
 * (task `embed`). "limit" when the Daily limit is reached.
 */
async function embedNames(
  supabase: AdminSupabase,
  owner: string,
  named: ReadonlyArray<Omit<Assumed, "embedding">>,
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
  return named.map(({ kcId, name, description }) => ({
    kcId,
    name,
    description,
    embedding: vectors[texts.indexOf(textOf({ kcId, name, description }))]!,
  }));
}

/** The index of the assumed name each offered name stands for, by object. */
const indexOf = new WeakMap<OfferedName, number>();
/** The stored KC id each offered candidate stands for, by object. */
const kcIdOf = new WeakMap<OfferedKc, string>();

/**
 * Offers each name its candidates, those `offer` accepts (all by
 * default), and asks the check calls. Returns what each name means, by its
 * index: a name without candidates means none without a call, and a name
 * not offered is left out. Also the names whose call never started or met
 * the Daily limit (`unasked`), those whose call failed, and whether the
 * limit was reached.
 */
async function checkNames(
  supabase: AdminSupabase,
  owner: string,
  courseId: string,
  assumed: readonly Assumed[],
  stepStartedAt: number,
  offer: (candidates: string[]) => boolean = () => true,
): Promise<{
  meanings: Map<number, Meaning>;
  unasked: Set<number>;
  failed: Set<number>;
  limitReached: boolean;
}> {
  const meanings = new Map<number, Meaning>();
  if (assumed.length === 0) {
    return {
      meanings,
      unasked: new Set(),
      failed: new Set(),
      limitReached: false,
    };
  }
  const map = await loadMapInput(supabase, courseId);
  const places = firstSourcePlaces(map);
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

  const offered: OfferedName[] = [];
  assumed.forEach((item, index) => {
    const user = kcs.get(item.kcId);
    const ids = nearest[index]!;
    if (!user || !offer(ids)) return;
    if (ids.length === 0) {
      meanings.set(index, "none");
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
    indexOf.set(name, index);
    offered.push(name);
  });

  const calls: OfferedName[][] = [];
  for (let start = 0; start < offered.length; start += NAMES_PER_CALL) {
    calls.push(offered.slice(start, start + NAMES_PER_CALL));
  }
  const started = new Set<OfferedName[]>();
  const failedCalls = new Set<OfferedName[]>();
  let limitReached = false;
  const runCall = async (names: OfferedName[]) => {
    started.add(names);
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
      started.delete(names);
      return "stop" as const;
    }
    if (answer === "failed") {
      failedCalls.add(names);
      return;
    }
    for (const name of names) {
      const index = indexOf.get(name)!;
      const meant = name.candidates.find(
        (kc) => kc.id === answer.meanings[name.id],
      );
      if (!meant) {
        meanings.set(index, "none");
        continue;
      }
      // A KC the Course teaches later would be a forward link: none.
      const from = kcIdOf.get(meant)!;
      const place = places.get(assumed[index]!.kcId) ?? Infinity;
      meanings.set(
        index,
        (places.get(from) ?? Infinity) < place ? { from } : "later",
      );
    }
  };
  await runCalls(calls, runCall, stepStartedAt);

  const indexesOf = (names: OfferedName[][]) =>
    new Set(names.flatMap((call) => call.map((name) => indexOf.get(name)!)));
  return {
    meanings,
    unasked: indexesOf(calls.filter((names) => !started.has(names))),
    failed: indexesOf([...failedCalls]),
    limitReached,
  };
}
