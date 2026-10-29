import { createHash } from "node:crypto";
import type { KnowledgeMap } from "@/features/knowledge-map/schemas";

/**
 * What a Student reads around a stored Topic (#175): its anchors and its
 * Reading sections, both derived on read, the sections cut from the chunks
 * its KCs cite (#224).
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

/** A part of a Topic's source pages, in one Material, as the cut gives it. */
export type SectionCut = {
  materialId: string;
  materialName: string;
  pageFrom: number;
  pageTo: number;
  chunkIds: string[];
};

/**
 * A Reading section (#224): its cut, with an id that stays the same while
 * the cut does.
 */
export type ReadingSection = SectionCut & { id: string };

/**
 * A section's id: a UUID v5 (RFC 9562) of its Topic id, Material id and
 * pages, in the Topic id's namespace. A Done mark
 * (`chat_messages.reading_section_id`) keeps matching while the cut stays.
 */
export function readingSectionId(
  topicId: string,
  cut: Pick<SectionCut, "materialId" | "pageFrom" | "pageTo">,
): string {
  const namespace = Buffer.from(topicId.replaceAll("-", ""), "hex");
  const name = `${cut.materialId}:${cut.pageFrom}-${cut.pageTo}`;
  const hash = createHash("sha1").update(namespace).update(name).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The Topic's Reading sections, cut with `readingSections`, with their ids. */
export function topicReadingSections(
  topicId: string,
  sourceChunkIds: Iterable<string>,
  chunks: readonly ChunkSpan[],
): ReadingSection[] {
  return readingSections(sourceChunkIds, chunks).map((cut) => ({
    id: readingSectionId(topicId, cut),
    ...cut,
  }));
}

/**
 * The Topic's anchors: Prerequisites of its KCs that sit outside it, each
 * once, in map order.
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
): SectionCut[] {
  const wanted = new Set(sourceChunkIds);
  const sections: SectionCut[] = [];
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
