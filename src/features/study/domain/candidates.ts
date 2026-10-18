/**
 * The candidate KCs the AI picks from when it proposes what to learn next
 * (#102, #103): up to 10 KCs that are new (neither prior knowledge nor
 * taught), have a Priority above 0 and whose Prerequisites are each prior
 * knowledge or taught. Pure code; the tutor context feeds it the stored
 * map, the Priorities and the taught KCs on every reply.
 */

/** What candidate selection reads of a Course's map, in map order. */
export type CandidateMap = {
  bigIdeas: Array<{ id: string; name: string }>;
  kcs: Array<{
    id: string;
    name: string;
    type: string;
    /** Null for prior knowledge. */
    bigIdea: string | null;
  }>;
  /** `from` must be learned before `to`. */
  prerequisites: Array<{ from: string; to: string }>;
};

/** A KC the AI may teach next, with the KCs it docks onto. */
type Candidate = {
  id: string;
  name: string;
  type: string;
  /** Its Prerequisites, each prior knowledge or taught. */
  anchors: Array<{ id: string; name: string }>;
};

/** Candidates of one big idea, best ranked first. */
export type CandidateGroup = { bigIdea: string; kcs: Candidate[] };

const MAX_CANDIDATES = 10;

/**
 * The candidates of a map, grouped by big idea. They are ranked by Priority,
 * KCs without one last, ties in map order; the groups follow their best
 * ranked KC. `priorities` maps KC ids to their Priority; `taught` holds the
 * ids of KCs with attempts.
 */
export function selectCandidates(
  map: CandidateMap,
  priorities: Record<string, number>,
  taught: ReadonlySet<string> = new Set(),
): CandidateGroup[] {
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const isKnown = (id: string) =>
    kcById.get(id)?.bigIdea === null || taught.has(id);
  const prerequisitesOf = (id: string) =>
    map.prerequisites
      .filter((link) => link.to === id && kcById.has(link.from))
      .map((link) => kcById.get(link.from)!);

  const ranked = map.kcs
    .map((kc, position) => ({ kc, position, priority: priorities[kc.id] }))
    .filter(
      ({ kc, priority }) =>
        !isKnown(kc.id) &&
        (priority === undefined || priority > 0) &&
        prerequisitesOf(kc.id).every((prerequisite) =>
          isKnown(prerequisite.id),
        ),
    )
    .toSorted(
      (a, b) =>
        (b.priority ?? -1) - (a.priority ?? -1) || a.position - b.position,
    )
    .slice(0, MAX_CANDIDATES);

  const bigIdeaName = new Map(map.bigIdeas.map(({ id, name }) => [id, name]));
  const groups = new Map<string, CandidateGroup>();
  for (const { kc } of ranked) {
    const bigIdea = kc.bigIdea!;
    if (!groups.has(bigIdea)) {
      groups.set(bigIdea, { bigIdea: bigIdeaName.get(bigIdea) ?? "", kcs: [] });
    }
    groups.get(bigIdea)!.kcs.push({
      id: kc.id,
      name: kc.name,
      type: kc.type,
      anchors: prerequisitesOf(kc.id).map(({ id, name }) => ({ id, name })),
    });
  }
  return [...groups.values()];
}
