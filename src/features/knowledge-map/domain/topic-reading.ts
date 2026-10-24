import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * What a Student reads around a stored Topic (#175), derived on read from
 * the map and the chunks: its anchors, and its Reading sections.
 */

/** The most pages one Reading section spans. */
export const MAX_SECTION_PAGES = 3;

/** A chunk's place: its Material, and the pages it covers. */
export type ChunkSpan = {
  id: string;
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
};

/** A part of a Topic's source pages, in one Material. */
export type ReadingSection = {
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
  chunkIds: string[];
};

/**
 * The Topic's anchors: Prerequisites of its KCs that sit outside it, prior
 * KCs included, each once, in map order.
 */
export function topicAnchors(
  kcIds: readonly string[],
  map: Pick<KnowledgeMap, "kcs" | "prerequisites">,
): Array<{ id: string; name: string }> {
  const inside = new Set(kcIds);
  const needed = new Set(
    map.prerequisites
      .filter((link) => inside.has(link.to) && !inside.has(link.from))
      .map((link) => link.from),
  );
  return map.kcs
    .filter((kc) => needed.has(kc.id))
    .map((kc) => ({ id: kc.id, name: kc.name }));
}

/**
 * The Topic's Reading sections: the chunks its KCs cite, each once, in
 * Material order (`chunks` is every chunk in reading order). A new section
 * starts when the Material changes or the section would span more than
 * `MAX_SECTION_PAGES` pages; a single chunk longer than that is a section
 * of its own.
 */
export function readingSections(
  sourceChunkIds: Iterable<string>,
  chunks: readonly ChunkSpan[],
): ReadingSection[] {
  const wanted = new Set(sourceChunkIds);
  const sections: ReadingSection[] = [];
  for (const chunk of chunks.filter((item) => wanted.has(item.id))) {
    const last = sections.at(-1);
    const pageTo = Math.max(chunk.pageTo, last?.pageTo ?? 0);
    if (
      last &&
      last.materialId === chunk.materialId &&
      pageTo - last.pageFrom + 1 <= MAX_SECTION_PAGES
    ) {
      last.pageTo = pageTo;
      last.chunkIds.push(chunk.id);
    } else {
      sections.push({
        materialId: chunk.materialId,
        materialName: chunk.materialName,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        chunkIds: [chunk.id],
      });
    }
  }
  return sections;
}
