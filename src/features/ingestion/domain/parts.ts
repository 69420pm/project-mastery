import { rootKey } from "@/features/ingestion/domain/exercise-keys";
import type { ChunkLabel } from "@/features/ingestion/types";

/** A chunk of one Material, in reading order, as Parts see it. */
export type PartChunk = {
  label: ChunkLabel;
  markdown: string;
  pageFrom: number;
  pageTo: number;
  exerciseNumber: string | null;
  /** Its key (`exerciseKeys`). */
  key: string | null;
  /** Its chapter title (`chunkChapters`). */
  chapter: string;
};

export type PartKind = "teaching" | "exercise";

/** A Part: a run of chunks under one heading. */
export type DraftPart = {
  kind: PartKind;
  title: string;
  chapterTitle: string;
  /** Indexes into the chunks, in order. */
  chunks: number[];
};

/** A teaching Part under this many words joins a neighbour. */
export const MIN_PART_WORDS = 400;

/** A teaching Part over this many words is split. */
export const MAX_PART_WORDS = 4000;

/** A Markdown heading at the start of a chunk. */
const HEADING_START = /^\s*#{1,6} +(.+?)\s*#*\s*(?:\n|$)/;

function heading(markdown: string): string | null {
  return HEADING_START.exec(markdown)?.[1]?.trim() || null;
}

function words(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

/**
 * A Material's Parts, ordered by their first chunk. Teaching Parts hold
 * its content chunks: each chunk that starts with a Markdown heading, or
 * in a new chapter, starts a candidate titled by that heading (or chapter);
 * chunks before the first are titled by the Material's name. A candidate
 * under MIN_PART_WORDS joins the next one in its chapter, or the previous
 * one at the chapter's end; one over MAX_PART_WORDS splits at its next
 * heading, else at a page boundary. Exercise Parts hold its exercise and
 * solution chunks: a run of consecutive non-admin chunks of one label with
 * the same root key; a chunk without a key is its own Part. Admin chunks
 * belong to no Part.
 */
export function buildParts(
  chunks: PartChunk[],
  materialName: string,
): DraftPart[] {
  const teaching = teachingParts(chunks, materialName);
  const exercise = exerciseParts(chunks, materialName);
  return [...teaching, ...exercise].sort((a, b) => a.chunks[0]! - b.chunks[0]!);
}

function teachingParts(chunks: PartChunk[], materialName: string) {
  const candidates: DraftPart[] = [];
  chunks.forEach((chunk, index) => {
    if (chunk.label !== "content") return;
    const title = heading(chunk.markdown);
    const current = candidates.at(-1);
    if (current && !title && current.chapterTitle === chunk.chapter) {
      current.chunks.push(index);
      return;
    }
    candidates.push({
      kind: "teaching",
      title: title ?? (current ? chunk.chapter : materialName),
      chapterTitle: chunk.chapter,
      chunks: [index],
    });
  });
  const size = (part: DraftPart) =>
    part.chunks.reduce((sum, index) => sum + words(chunks[index]!.markdown), 0);
  return merged(candidates, size).flatMap((part) => split(part, chunks));
}

/**
 * Joins each candidate under MIN_PART_WORDS to the next one in its chapter,
 * or to the previous one when it ends its chapter.
 */
function merged(
  candidates: DraftPart[],
  size: (part: DraftPart) => number,
): DraftPart[] {
  const parts: DraftPart[] = [];
  let current: DraftPart | undefined;
  for (const next of [...candidates, undefined]) {
    if (!current) {
      current = next;
      continue;
    }
    const small = size(current) < MIN_PART_WORDS;
    if (small && next && next.chapterTitle === current.chapterTitle) {
      current = { ...current, chunks: [...current.chunks, ...next.chunks] };
      continue;
    }
    const previous = parts.at(-1);
    if (small && previous?.chapterTitle === current.chapterTitle) {
      previous.chunks.push(...current.chunks);
    } else {
      parts.push(current);
    }
    current = next;
  }
  return parts;
}

/**
 * Splits a Part once it passes MAX_PART_WORDS: before its next chunk that
 * starts with a heading, or, without one, before its next chunk on a new
 * page. A piece that starts with a heading is titled by it.
 */
function split(part: DraftPart, chunks: PartChunk[]): DraftPart[] {
  const pieces: DraftPart[] = [];
  let piece: number[] = [];
  let count = 0;
  part.chunks.forEach((index, at) => {
    const chunk = chunks[index]!;
    if (count > MAX_PART_WORDS && piece.length > 0) {
      const rest = part.chunks.slice(at).map((later) => chunks[later]!);
      const headingAhead = rest.some((later) => heading(later.markdown));
      const previous = chunks[piece.at(-1)!]!;
      const cut = headingAhead
        ? heading(chunk.markdown) !== null
        : chunk.pageFrom > previous.pageTo;
      if (cut) {
        pieces.push({ ...part, chunks: piece });
        piece = [];
        count = 0;
      }
    }
    piece.push(index);
    count += words(chunk.markdown);
  });
  pieces.push({ ...part, chunks: piece });
  return pieces.map((each, at) => ({
    ...each,
    title:
      at === 0
        ? part.title
        : (heading(chunks[each.chunks[0]!]!.markdown) ?? part.title),
  }));
}

function exerciseParts(chunks: PartChunk[], materialName: string) {
  const parts: DraftPart[] = [];
  let open: { part: DraftPart; label: ChunkLabel; root: string } | null = null;
  chunks.forEach((chunk, index) => {
    if (chunk.label === "admin") return;
    if (chunk.label === "content") {
      open = null;
      return;
    }
    const root = rootKey(chunk.key);
    if (
      open &&
      root !== null &&
      open.label === chunk.label &&
      open.root === root
    ) {
      open.part.chunks.push(index);
      return;
    }
    const part: DraftPart = {
      kind: "exercise",
      title: chunk.exerciseNumber ?? heading(chunk.markdown) ?? materialName,
      chapterTitle: chunk.chapter,
      chunks: [index],
    };
    parts.push(part);
    open = root === null ? null : { part, label: chunk.label, root };
  });
  return parts;
}
