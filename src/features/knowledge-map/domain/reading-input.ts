import type { SectionCut } from "@/features/knowledge-map/domain/topic-reading";

/**
 * What the `reading` calls of stage 2c (#178) are sent for one new Reading
 * section, and how code builds it from the stored Topic, KCs and chunks.
 */

/** A chunk's text, as the calls read it. */
export type ReadingChunk = {
  pageFrom: number;
  pageTo: number;
  label: string;
  markdown: string;
  /** What its figure shows; null without one. */
  figureDescription: string | null;
};

/** What both `reading` calls are sent for a section. */
export type ReadingCallInput = {
  topic: { name: string; centralQuestion: string };
  section: { pageFrom: number; pageTo: number };
  /** The Topic's KCs that cite one of the section's chunks. */
  kcs: Array<{ name: string; type: string; description: string }>;
  /** The section's chunks in reading order. */
  chunks: ReadingChunk[];
};

type Kc = {
  id: string;
  name: string;
  type: string;
  description: string;
  sources: string[];
};

/**
 * The call input of a section of `topic`: its KCs among `kcs` that cite one
 * of the section's chunks, in the Topic's order, and its chunks among
 * `chunks` (by id) in its order. Deleted chunks are left out.
 */
export function readingCallInput(
  topic: { name: string; centralQuestion: string; kcs: readonly string[] },
  cut: SectionCut,
  kcs: readonly Kc[],
  chunks: Readonly<Record<string, ReadingChunk>>,
): ReadingCallInput {
  const inSection = new Set(cut.chunkIds);
  const byId = new Map(kcs.map((kc) => [kc.id, kc]));
  return {
    topic: { name: topic.name, centralQuestion: topic.centralQuestion },
    section: { pageFrom: cut.pageFrom, pageTo: cut.pageTo },
    kcs: topic.kcs.flatMap((id) => {
      const kc = byId.get(id);
      return kc && kc.sources.some((source) => inSection.has(source))
        ? [{ name: kc.name, type: kc.type, description: kc.description }]
        : [];
    }),
    chunks: cut.chunkIds.flatMap((id) => {
      const chunk = chunks[id];
      return chunk
        ? [
            {
              pageFrom: chunk.pageFrom,
              pageTo: chunk.pageTo,
              label: chunk.label,
              markdown: chunk.markdown,
              figureDescription: chunk.figureDescription,
            },
          ]
        : [];
    }),
  };
}
