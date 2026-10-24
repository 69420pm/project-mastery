import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * Topics (#175): the KCs of each Big idea grouped into teachable units with
 * a central question. One `topic` call per Big idea places the KCs no Topic
 * holds yet; code checks its answer, keeps what is stored (placed KCs stay
 * in their Topic, stored Topics keep their name and question), merges Topics
 * under 2 KCs and orders the KCs in each Topic and the Topics in the Course.
 * Prior KCs belong to no Topic.
 */

/** A Topic, its KCs in teaching order; a new one has a null id. */
export type Topic = {
  id: string | null;
  bigIdea: string;
  name: string;
  centralQuestion: string;
  whyItMatters: string;
  kcs: string[];
};

/**
 * One Topic the model proposes for a Big idea: a stored Topic by its id, or
 * a new one under any other id, with its KCs in teaching order.
 */
export type TopicProposal = {
  id: string;
  name: string;
  centralQuestion: string;
  whyItMatters: string;
  kcs: string[];
};

type MapLinks = Pick<KnowledgeMap, "prerequisites" | "semanticLinks">;

/**
 * The stored Topics on the current map: a KC removed from the map, made
 * prior or moved to another Big idea leaves its Topic, and a Topic whose Big
 * idea is gone goes. A Topic may be left empty here; the rules delete it.
 */
export function topicsOnMap(
  map: Pick<KnowledgeMap, "bigIdeas" | "kcs">,
  topics: Topic[],
): Topic[] {
  const bigIdeaOf = new Map(
    map.kcs.flatMap((kc) =>
      kc.bigIdea === null ? [] : [[kc.id, kc.bigIdea] as const],
    ),
  );
  const bigIdeas = new Set(map.bigIdeas.map((bigIdea) => bigIdea.id));
  const placed = new Set<string>();
  return topics
    .filter((topic) => bigIdeas.has(topic.bigIdea))
    .map((topic) => ({
      ...topic,
      kcs: topic.kcs.filter((id) => {
        const keep = bigIdeaOf.get(id) === topic.bigIdea && !placed.has(id);
        if (keep) placed.add(id);
        return keep;
      }),
    }));
}

/**
 * The non-prior KCs no Topic holds, by Big idea in map order, each in map
 * order. A Big idea without any needs no `topic` call.
 */
export function unplacedKcs(
  map: Pick<KnowledgeMap, "bigIdeas" | "kcs">,
  topics: Topic[],
): Map<string, string[]> {
  const placed = new Set(topics.flatMap((topic) => topic.kcs));
  const unplaced = new Map<string, string[]>();
  for (const bigIdea of map.bigIdeas) {
    const ids = map.kcs
      .filter((kc) => kc.bigIdea === bigIdea.id && !placed.has(kc.id))
      .map((kc) => kc.id);
    if (ids.length > 0) unplaced.set(bigIdea.id, ids);
  }
  return unplaced;
}

/**
 * Throws unless every new KC appears exactly once in the proposals and every
 * KC they name is one the call was sent, so the step retries the call.
 */
export function checkTopicProposals(
  proposals: TopicProposal[],
  newKcIds: readonly string[],
  sentKcIds: readonly string[],
): void {
  const sent = new Set(sentKcIds);
  const counts = new Map<string, number>();
  for (const id of proposals.flatMap((proposal) => proposal.kcs)) {
    if (!sent.has(id)) throw new Error(`The Topics name an unknown KC ${id}.`);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of newKcIds) {
    const count = counts.get(id) ?? 0;
    if (count !== 1) {
      throw new Error(
        `The Topics hold the new KC ${id} ${count === 0 ? "nowhere" : `${count} times`}.`,
      );
    }
  }
}

/**
 * The Topics with a Big idea's checked proposals taken in. Code wins over
 * the model: placed KCs stay where they are and stored Topics keep their
 * name and question. Only the new KCs' placement is taken, after a stored
 * Topic's KCs, and new Topics that hold a new KC.
 */
export function withTopicProposals(
  topics: Topic[],
  bigIdea: string,
  proposals: TopicProposal[],
  newKcIds: readonly string[],
): Topic[] {
  const isNew = new Set(newKcIds);
  const result = topics.map((topic) => ({ ...topic, kcs: [...topic.kcs] }));
  const added = new Map<string, Topic>();
  for (const proposal of proposals) {
    const kcs = proposal.kcs.filter((id) => isNew.has(id));
    const stored = result.find(
      (topic) => topic.id === proposal.id && topic.bigIdea === bigIdea,
    );
    const target =
      stored ??
      added.get(proposal.id) ??
      added
        .set(proposal.id, {
          id: null,
          bigIdea,
          name: proposal.name,
          centralQuestion: proposal.centralQuestion,
          whyItMatters: proposal.whyItMatters,
          kcs: [],
        })
        .get(proposal.id);
    target?.kcs.push(...kcs);
  }
  return [
    ...result,
    ...[...added.values()].filter((topic) => topic.kcs.length > 0),
  ];
}

/**
 * The rules every build applies over all Topics: an empty Topic goes, a
 * Topic under 2 KCs merges into another of its Big idea (`withMerges`), the
 * KCs of each Topic are put in teaching order and the Topics in Course order
 * (`topicOrder`). `chunkOrder` is the Course's chunk ids in Material order.
 */
export function withTopicRules(
  map: Pick<KnowledgeMap, "kcs"> & MapLinks,
  topics: Topic[],
  chunkOrder: readonly string[],
): Topic[] {
  const rank = kcRanks(map, chunkOrder);
  const merged = withMerges(
    topics.filter((topic) => topic.kcs.length > 0),
    map,
    rank,
  ).map((topic) => ({
    ...topic,
    kcs: teachingOrder(topic.kcs, map.prerequisites),
  }));
  return topicOrder(merged, map.prerequisites, rank);
}

/**
 * Each KC's place in the Course: its earliest source chunk in Material
 * order, and after every chunk, by map order, for KCs without a source.
 */
function kcRanks(
  map: Pick<KnowledgeMap, "kcs">,
  chunkOrder: readonly string[],
): (kcId: string) => number {
  const chunkRank = new Map(chunkOrder.map((id, index) => [id, index]));
  const ranks = new Map(
    map.kcs.map((kc, index) => {
      const sourced = kc.sources.flatMap((id) => chunkRank.get(id) ?? []);
      return [
        kc.id,
        sourced.length > 0 ? Math.min(...sourced) : chunkOrder.length + index,
      ];
    }),
  );
  return (kcId) => ranks.get(kcId) ?? Number.MAX_SAFE_INTEGER;
}

const firstSource = (topic: Topic, rank: (kcId: string) => number) =>
  Math.min(...topic.kcs.map(rank));

/**
 * Merges each Topic under 2 KCs into the Topic of its Big idea that shares
 * the most Prerequisites and Semantic links with it; ties or none go to the
 * nearest first source, then to the earlier Topic. The absorbing Topic keeps
 * its id, name and question. A Big idea's only Topic stays as it is.
 */
export function withMerges(
  topics: Topic[],
  links: MapLinks,
  rank: (kcId: string) => number,
): Topic[] {
  const result = [...topics];
  const allLinks = [...links.prerequisites, ...links.semanticLinks];
  const shared = (a: Topic, b: Topic) =>
    allLinks.filter(
      (link) =>
        (a.kcs.includes(link.from) && b.kcs.includes(link.to)) ||
        (b.kcs.includes(link.from) && a.kcs.includes(link.to)),
    ).length;
  for (;;) {
    const small = result.find(
      (topic) =>
        topic.kcs.length < 2 &&
        result.some(
          (other) => other !== topic && other.bigIdea === topic.bigIdea,
        ),
    );
    if (!small) return result;
    const start = firstSource(small, rank);
    const score = (topic: Topic) =>
      [
        shared(small, topic),
        -Math.abs(firstSource(topic, rank) - start),
      ] as const;
    const target = result
      .filter((topic) => topic !== small && topic.bigIdea === small.bigIdea)
      .reduce((best, topic) => {
        const [links, near] = score(topic);
        const [bestLinks, bestNear] = score(best);
        return links > bestLinks || (links === bestLinks && near > bestNear)
          ? topic
          : best;
      });
    result[result.indexOf(target)] = {
      ...target,
      kcs: [...target.kcs, ...small.kcs],
    };
    result.splice(result.indexOf(small), 1);
  }
}

/**
 * KCs in the given order, stably re-sorted so a KC comes after its
 * Prerequisites among them.
 */
export function teachingOrder(
  kcIds: string[],
  prerequisites: KnowledgeMap["prerequisites"],
): string[] {
  const index = new Map(kcIds.map((id, position) => [id, position]));
  return prerequisiteOrder(
    kcIds,
    (a, b) => prerequisites.some((link) => link.from === a && link.to === b),
    (id) => index.get(id) ?? 0,
  );
}

/**
 * Topics in Course order: Topic A comes before B when a KC of A is a
 * Prerequisite of a KC of B. Among the ready Topics the one with the
 * earliest first source goes first; a cycle is broken by taking its Topic
 * with the earliest first source.
 */
export function topicOrder(
  topics: Topic[],
  prerequisites: KnowledgeMap["prerequisites"],
  rank: (kcId: string) => number,
): Topic[] {
  return prerequisiteOrder(
    topics,
    (a, b) =>
      prerequisites.some(
        (link) => a.kcs.includes(link.from) && b.kcs.includes(link.to),
      ),
    (topic) => firstSource(topic, rank),
  );
}

/**
 * Items with each after those `before` it, taking the lowest `rank` among
 * the ready ones (the earlier item on a tie). When none is ready, the
 * lowest-ranked item on a cycle goes next.
 */
function prerequisiteOrder<Item>(
  items: Item[],
  before: (a: Item, b: Item) => boolean,
  rank: (item: Item) => number,
): Item[] {
  const left = [...items];
  const ordered: Item[] = [];
  const preceded = (item: Item) =>
    left.some((other) => other !== item && before(other, item));
  const onCycle = (item: Item) => {
    const seen = new Set<Item>();
    const stack = [item];
    while (stack.length > 0) {
      const current = stack.pop() as Item;
      for (const next of left) {
        if (next === current || !before(current, next)) continue;
        if (next === item) return true;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  while (left.length > 0) {
    const ready = left.filter((item) => !preceded(item));
    const pool = ready.length > 0 ? ready : left.filter(onCycle);
    const next = (pool.length > 0 ? pool : left).reduce((best, item) =>
      rank(item) < rank(best) ? item : best,
    );
    ordered.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return ordered;
}
