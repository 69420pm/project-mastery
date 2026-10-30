import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * Topics (#175): teachable units of a Big idea's KCs with a central
 * question. The KCs of each Topic come in teaching order and the Topics in
 * Course order, both with Prerequisites first.
 */

/** A Topic, its KCs in teaching order; a new one has a null id. */
export type Topic = {
  id: string | null;
  bigIdea: string;
  name: string;
  centralQuestion: string;
  kcs: string[];
};

const firstSource = (
  topic: Pick<Topic, "kcs">,
  rank: (kcId: string) => number,
) => Math.min(...topic.kcs.map(rank));

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
 * earliest first source (`rank` of a KC) goes first; a cycle is broken by
 * taking its Topic with the earliest first source.
 */
export function topicOrder<T extends Pick<Topic, "kcs">>(
  topics: T[],
  prerequisites: KnowledgeMap["prerequisites"],
  rank: (kcId: string) => number,
): T[] {
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
