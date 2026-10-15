import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * What an update of a stored Knowledge map works on (#83): the chunks no
 * update has processed yet, and the stored map without what deleted chunks
 * taught.
 */

/** The chunks not among the processed ones, in their order. */
export function newChunks<Chunk extends { id: string }>(
  chunks: Chunk[],
  processedIds: string[],
): Chunk[] {
  const processed = new Set(processedIds);
  return chunks.filter((chunk) => !processed.has(chunk.id));
}

/**
 * The map without taught KCs (content or exercise origin) that have no
 * source chunk left, prior KCs no remaining KC needs, Findings with no
 * source chunk left and big ideas left with no KC, and without the links and
 * Exercise KCs of the KCs that go.
 */
export function withoutRemoved(map: KnowledgeMap): KnowledgeMap {
  const taught = new Set(
    map.kcs
      .filter((kc) => kc.origin !== "prior" && kc.sources.length > 0)
      .map((kc) => kc.id),
  );
  const needed = new Set(
    map.prerequisites
      .filter((link) => taught.has(link.to))
      .map((link) => link.from),
  );
  const kcs = map.kcs.filter(
    (kc) => taught.has(kc.id) || (kc.origin === "prior" && needed.has(kc.id)),
  );
  const kept = new Set(kcs.map((kc) => kc.id));
  const linksKept = (link: { from: string; to: string }) =>
    kept.has(link.from) && kept.has(link.to);
  return {
    bigIdeas: map.bigIdeas.filter((bigIdea) =>
      kcs.some((kc) => kc.bigIdea === bigIdea.id),
    ),
    kcs,
    prerequisites: map.prerequisites.filter(linksKept),
    semanticLinks: map.semanticLinks.filter(linksKept),
    exercises: map.exercises.map((exercise) => ({
      ...exercise,
      kcs: exercise.kcs.filter((id) => kept.has(id)),
    })),
    findings: map.findings.filter((finding) => finding.sources.length > 0),
  };
}

/**
 * Short ids for a model call: the n-th of `ids` is `<prefix><n>`, so a call
 * never sends stored row ids. `real` turns an id the model answered back
 * into the map's, and leaves an unknown one as it is.
 */
export function aliases(ids: string[], prefix: string) {
  const local = new Map(ids.map((id, index) => [id, `${prefix}${index + 1}`]));
  const real = new Map([...local].map(([id, alias]) => [alias, id]));
  return {
    local: (id: string) => local.get(id) ?? id,
    real: (alias: string) => real.get(alias) ?? alias,
  };
}
