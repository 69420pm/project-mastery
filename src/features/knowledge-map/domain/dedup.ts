import { withLinks } from "@/features/knowledge-map/domain/links";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * Merging duplicate KCs after an update (#83): new KCs are compared with
 * every KC of the map by the cosine similarity of their embeddings, pairs at
 * or above the threshold form clusters, a model call decides which KCs of a
 * cluster are one, and code merges those.
 */

/** The similarity at or above which two KCs may be duplicates: a guess. */
export const DEDUP_THRESHOLD = 0.85;

/** Two KCs whose embeddings are at least `DEDUP_THRESHOLD` alike. */
export type SimilarPair = { a: string; b: string; similarity: number };

/** What one KC is embedded as. */
export const kcEmbeddingText = (kc: { name: string; description: string }) =>
  `${kc.name}: ${kc.description}`;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, index) => {
    const other = b[index] ?? 0;
    dot += value * other;
    normA += value * value;
    normB += other * other;
  });
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/**
 * Pairs of `kcs` (with `vectors` in the same order) at or above the
 * threshold where at least one KC is in `newIds`. Prior KCs pair only with
 * prior KCs, taught ones only with taught ones.
 */
export function similarPairs(
  kcs: Array<{ id: string; origin: string }>,
  vectors: number[][],
  newIds: ReadonlySet<string>,
  threshold = DEDUP_THRESHOLD,
): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  kcs.forEach((a, i) => {
    kcs.slice(i + 1).forEach((b, offset) => {
      const j = i + 1 + offset;
      if (!newIds.has(a.id) && !newIds.has(b.id)) return;
      if ((a.origin === "prior") !== (b.origin === "prior")) return;
      const similarity = cosine(vectors[i] ?? [], vectors[j] ?? []);
      if (similarity >= threshold) pairs.push({ a: a.id, b: b.id, similarity });
    });
  });
  return pairs;
}

/**
 * The connected components of the pairs, each in the order of `order` (the
 * map's KC ids), the clusters in the order of their first KC.
 */
export function clustersOf(pairs: SimilarPair[], order: string[]): string[][] {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const top = root(up);
    parent.set(id, top);
    return top;
  };
  const paired = new Set(pairs.flatMap(({ a, b }) => [a, b]));
  for (const { a, b } of pairs) parent.set(root(a), root(b));
  const clusters = new Map<string, string[]>();
  for (const id of order) {
    if (!paired.has(id)) continue;
    const key = root(id);
    clusters.set(key, [...(clusters.get(key) ?? []), id]);
  }
  return [...clusters.values()].filter((cluster) => cluster.length > 1);
}

/** One merge: the KC that stays and the names of those merged into it. */
export type Merge = { kept: string; merged: string[] };

/**
 * The map with each group of KCs merged into one, and the merges by name.
 * The group's first KC that existed before the update (in `existingIds`)
 * keeps its id; other existing KCs of the group stay apart, so a stored KC
 * never goes. Without one, the first new KC in map order stays. Sources and
 * Exercise KCs are joined, links move to the KC that stays, self-links go,
 * and cycles and redundant prerequisites go again. Groups use map ids; an id
 * an earlier group took, or an unknown one, is skipped.
 */
export function withMerges(
  map: KnowledgeMap,
  groups: string[][],
  existingIds: ReadonlySet<string>,
): {
  map: KnowledgeMap;
  merges: Merge[];
  droppedCycleEdges: KnowledgeMap["prerequisites"];
} {
  const position = new Map(map.kcs.map((kc, index) => [kc.id, index]));
  const into = new Map<string, string>();
  const taken = new Set<string>();
  for (const group of groups) {
    const ids = [...new Set(group)]
      .filter((id) => position.has(id) && !taken.has(id))
      .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    const kept = ids.find((id) => existingIds.has(id)) ?? ids[0];
    if (kept === undefined) continue;
    const merged = ids.filter((id) => id !== kept && !existingIds.has(id));
    if (merged.length === 0) continue;
    for (const id of [kept, ...merged]) taken.add(id);
    for (const id of merged) into.set(id, kept);
  }
  if (into.size === 0) return { map, merges: [], droppedCycleEdges: [] };

  const to = (id: string) => into.get(id) ?? id;
  const sources = new Map<string, string[]>();
  for (const kc of map.kcs) {
    const known = sources.get(to(kc.id)) ?? [];
    sources.set(to(kc.id), [...new Set([...known, ...kc.sources])]);
  }
  const kcs = map.kcs
    .filter((kc) => !into.has(kc.id))
    .map((kc) => ({ ...kc, sources: sources.get(kc.id) ?? kc.sources }));
  const moved = <Link extends { from: string; to: string }>(link: Link) => ({
    ...link,
    from: to(link.from),
    to: to(link.to),
  });
  const linked = withLinks(
    {
      ...map,
      kcs,
      bigIdeas: map.bigIdeas.filter((bigIdea) =>
        kcs.some((kc) => kc.bigIdea === bigIdea.id),
      ),
      exercises: map.exercises.map((exercise) => ({
        ...exercise,
        kcs: [...new Set(exercise.kcs.map(to))],
      })),
    },
    {
      prerequisites: map.prerequisites.map(moved),
      semanticLinks: map.semanticLinks.map(moved),
      priorKcs: [],
    },
  );

  const name = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  const merges = kcs
    .filter((kc) => [...into.values()].includes(kc.id))
    .map((kc) => ({
      kept: kc.name,
      merged: [...into]
        .filter(([, target]) => target === kc.id)
        .map(([id]) => name.get(id) ?? id),
    }));
  return {
    map: linked.map,
    merges,
    droppedCycleEdges: linked.droppedCycleEdges,
  };
}

/**
 * The pairs that are still two KCs of the map after the merges, by name:
 * the check report's `duplicates`.
 */
export function remainingDuplicates(
  map: Pick<KnowledgeMap, "kcs">,
  pairs: SimilarPair[],
): Array<{ a: string; b: string; similarity: number }> {
  const name = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  return pairs.flatMap(({ a, b, similarity }) => {
    const nameA = name.get(a);
    const nameB = name.get(b);
    return nameA && nameB
      ? [
          {
            a: nameA,
            b: nameB,
            similarity: Math.round(similarity * 1000) / 1000,
          },
        ]
      : [];
  });
}
