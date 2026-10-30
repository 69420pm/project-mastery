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
import { storedExtractionSchema } from "@/features/knowledge-map/schemas";
import {
  loadCourseParts,
  PARTS_PER_STEP,
  runCalls,
  touchBuild,
  type StepOutcome,
} from "@/features/knowledge-map/workflows/build-steps";
import { matchKcs } from "@/features/knowledge-map/workflows/consolidate-steps";
import {
  firstSourcePlaces,
  loadMapInput,
} from "@/features/knowledge-map/workflows/map-input";
import { meteredEmbed, meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";

/**
 * The Prerequisite check of a build: what each stored KC `assumes` becomes
 * a Prerequisite. Each name is embedded and matched to the 5 nearest KCs
 * first sourced earlier in Course order; one call (task `map`) per 25 names
 * with candidates picks the KC each means, or none.
 */

/** The most names one check call is asked about. */
const NAMES_PER_CALL = 25;
/** The earlier KCs a name is offered. */
const CANDIDATES = 5;
/** The nearest KCs searched for them. */
const SEARCHED = 20;

/** A name a stored KC assumes, by the batch's Part index. */
type Assumed = { part: number; kcId: string; name: string };

/**
 * Matches what the KCs of up to PARTS_PER_STEP stored Part extractions
 * assume, in Course order, and stores the Prerequisites with the
 * extractions marked matched. Parts whose calls the call window leaves out
 * wait for the next step. A reached Daily limit stops the build.
 */
export async function matchAssumptions(courseId: string): Promise<StepOutcome> {
  "use step";
  const supabase = createAdminClient();
  const owner = await touchBuild(supabase, courseId);
  if (!owner) return { ok: true, left: null };

  const [parts, rows] = await Promise.all([
    loadCourseParts(supabase, courseId),
    supabase
      .from("part_extractions")
      .select("part_id, output, kc_ids")
      .eq("course_id", courseId)
      .not("kc_ids", "is", null)
      .eq("assumes_matched", false),
  ]);
  if (rows.error) failed("Loading the Part extractions", rows.error);
  const order = new Map(parts.map((part, index) => [part.id, index]));
  const pending = rows.data
    .filter((row) => order.has(row.part_id))
    .toSorted((a, b) => order.get(a.part_id)! - order.get(b.part_id)!);
  if (pending.length === 0) return { ok: true, left: 0 };

  const batch = pending.slice(0, PARTS_PER_STEP);
  const assumed: Assumed[] = batch.flatMap((row, part) =>
    storedExtractionSchema
      .parse(row.output)
      .kcs.flatMap((kc, k) =>
        kc.assumes.map((name) => ({ part, kcId: row.kc_ids![k]!, name })),
      ),
  );
  const offered = await offerNames(supabase, owner, courseId, assumed);
  if (offered === "limit") return { ok: false, reason: dailyLimitReason };

  const calls: OfferedName[][] = [];
  for (let start = 0; start < offered.length; start += NAMES_PER_CALL) {
    calls.push(offered.slice(start, start + NAMES_PER_CALL));
  }
  const done = new Set<OfferedName[]>();
  const links: Array<Link & { part: number }> = [];
  let limitReached = false;
  await runCalls(calls, async (names) => {
    const result = await meteredGenerate(
      supabase,
      { studentId: owner, task: "map", traceName: "check-prerequisites" },
      {
        ...prerequisiteCheckSettings(names),
        messages: prerequisiteCheckMessages(names),
      },
    );
    if (!result) {
      limitReached = true;
      return "stop";
    }
    const { meanings } = prerequisiteCheckSchema(names).parse(result.output);
    for (const name of names) {
      const meant = name.candidates.find((kc) => kc.id === meanings[name.id]);
      const { part, kcId } = assumedOf.get(name)!;
      if (meant) links.push({ part, from: kcIdOf.get(meant)!, to: kcId });
    }
    done.add(names);
  });

  const unready = new Set(
    calls
      .filter((names) => !done.has(names))
      .flatMap((names) => names.map((name) => assumedOf.get(name)!.part)),
  );
  const ready = batch.flatMap((row, part) =>
    unready.has(part) ? [] : [row.part_id],
  );
  const stored = await supabase
    .from("prerequisite_links")
    .select("from_kc, to_kc")
    .eq("course_id", courseId);
  if (stored.error) failed("Loading the Prerequisites", stored.error);
  const { data, error } = await supabase.rpc("store_assumed_prerequisites", {
    p_course_id: courseId,
    p_prerequisites: acyclicLinks(
      stored.data.map((link) => ({ from: link.from_kc, to: link.to_kc })),
      links
        .filter((link) => !unready.has(link.part))
        .map(({ from, to }) => ({ from, to })),
    ),
    p_part_ids: ready,
  });
  if (error) failed("Storing the assumed Prerequisites", error);
  if (!data) return { ok: true, left: null };
  if (limitReached) return { ok: false, reason: dailyLimitReason };
  return { ok: true, left: pending.length - ready.length };
}

/** The assumed name each offered name stands for, by object. */
const assumedOf = new WeakMap<OfferedName, Assumed>();
/** The stored KC id each offered candidate stands for, by object. */
const kcIdOf = new WeakMap<OfferedKc, string>();

/**
 * The names with their candidates: the KCs among the SEARCHED nearest to
 * the name's vector whose first source comes before the assuming KC's, at
 * most CANDIDATES. Names without one are left out. "limit" when the Daily
 * limit is reached.
 */
async function offerNames(
  supabase: ReturnType<typeof createAdminClient>,
  owner: string,
  courseId: string,
  assumed: Assumed[],
): Promise<OfferedName[] | "limit"> {
  if (assumed.length === 0) return [];
  const texts = [...new Set(assumed.map((item) => item.name))];
  const vectors = await meteredEmbed(
    supabase,
    { studentId: owner, traceName: "embed-assumed" },
    { values: texts },
  );
  if (!vectors) return "limit";
  const map = await loadMapInput(supabase, courseId);
  const places = firstSourcePlaces(map);
  const kcs = new Map(map.kcs.map((kc) => [kc.id, kc]));

  const offered: OfferedName[] = [];
  for (const item of assumed) {
    const place = places.get(item.kcId);
    const user = kcs.get(item.kcId);
    if (place === undefined || !user) continue;
    const nearest = await matchKcs(
      supabase,
      courseId,
      vectors[texts.indexOf(item.name)]!,
      SEARCHED,
      false,
    );
    const candidates = nearest
      .filter(({ id }) => (places.get(id) ?? Infinity) < place)
      .slice(0, CANDIDATES)
      .map(({ id }, index): OfferedKc => {
        const kc = kcs.get(id)!;
        const candidate = {
          id: `n${offered.length + 1}k${index + 1}`,
          name: kc.name,
          description: kc.description,
        };
        kcIdOf.set(candidate, id);
        return candidate;
      });
    if (candidates.length === 0) continue;
    const name: OfferedName = {
      id: `n${offered.length + 1}`,
      name: item.name,
      usedBy: `${user.name}: ${user.description}`,
      candidates: candidates as [OfferedKc, ...OfferedKc[]],
    };
    assumedOf.set(name, item);
    offered.push(name);
  }
  return offered;
}
