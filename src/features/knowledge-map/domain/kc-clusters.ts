/**
 * Consolidation of new KCs with alike ones by their vectors: which KCs a
 * merge call is asked about, and which KC each new one becomes.
 */

/** Cosine similarity from which two KCs may be the same KC. */
export const SAME_KC_SIMILARITY = 0.85;

/** Cosine similarity from which a new KC revives a retired one. */
export const REVIVE_SIMILARITY = 0.9;

/** The most KCs one cluster holds. */
export const MAX_CLUSTER_SIZE = 8;

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/** Two KCs, by key, at least SAME_KC_SIMILARITY alike. */
export type AlikePair = { a: string; b: string; similarity: number };

/**
 * The clusters of alike KCs, each of 2 to MAX_CLUSTER_SIZE: union-find over
 * the pairs, most alike first, where a pair that would make a cluster too
 * large stays apart, so a larger cluster splits by similarity. Clusters in
 * order of their first key in `pairs`.
 */
export function clusterKcs(
  pairs: readonly AlikePair[],
  maxSize = MAX_CLUSTER_SIZE,
): string[][] {
  const parent = new Map<string, string>();
  const members = new Map<string, string[]>();
  const root = (key: string): string => {
    if (!parent.has(key)) {
      parent.set(key, key);
      members.set(key, [key]);
    }
    let node = key;
    while (parent.get(node) !== node) node = parent.get(node)!;
    parent.set(key, node);
    return node;
  };
  const order = pairs.flatMap(({ a, b }) => [a, b]);
  for (const { a, b } of pairs.toSorted(
    (x, y) => y.similarity - x.similarity,
  )) {
    const [rootA, rootB] = [root(a), root(b)];
    if (rootA === rootB) continue;
    const joined = [...members.get(rootA)!, ...members.get(rootB)!];
    if (joined.length > maxSize) continue;
    parent.set(rootB, rootA);
    members.set(rootA, joined);
    members.delete(rootB);
  }
  const first = (keys: string[]) =>
    Math.min(...keys.map((key) => order.indexOf(key)));
  return [...members.values()]
    .filter((keys) => keys.length > 1)
    .map((keys) => keys.toSorted((x, y) => order.indexOf(x) - order.indexOf(y)))
    .toSorted((x, y) => first(x) - first(y));
}

/** A KC of a cluster: a new one, or a stored one with its age. */
export type ClusterKc =
  | { key: string; stored: false }
  | { key: string; stored: true; createdAt: string };

/**
 * The KC each new KC of a cluster merges into, by key, from the groups a
 * merge call named the same KC. A group keeps its oldest stored KC, or
 * without one its first new KC; its other new KCs merge into it. A stored
 * KC never merges into another, a group counts only within its cluster,
 * and a KC counts in its first group only.
 */
export function mergeTargets(
  cluster: readonly ClusterKc[],
  sameGroups: ReadonlyArray<readonly string[]>,
): Map<string, string> {
  const targets = new Map<string, string>();
  const grouped = new Set<string>();
  for (const group of sameGroups) {
    const kcs = cluster.filter(
      (kc) => group.includes(kc.key) && !grouped.has(kc.key),
    );
    for (const kc of kcs) grouped.add(kc.key);
    const stored = kcs
      .flatMap((kc) => (kc.stored ? [kc] : []))
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    const keeper = stored[0] ?? kcs[0];
    if (!keeper) continue;
    for (const kc of kcs) {
      if (!kc.stored && kc.key !== keeper.key) targets.set(kc.key, keeper.key);
    }
  }
  return targets;
}
