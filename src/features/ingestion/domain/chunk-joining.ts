import type { OutlineChapter } from "@/features/ingestion/domain/outline";
import type { BatchUnit } from "@/features/ingestion/domain/page-batches";
import type { ChunkLabel } from "@/features/ingestion/types";

/** A chunk made of one unit or of units joined across a batch edge. */
export type DraftChunk = {
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
  /** The position of the deepest Chapter it is in. */
  chapterPosition: number;
};

/** Where a Chapter starts, as cutting chunks needs it. */
export type ChapterStart = Pick<
  OutlineChapter,
  "position" | "depth" | "startUnit" | "startsAtHeading"
>;

/** The longest a chunk gets, in characters, unless one paragraph is longer. */
export const MAX_CHUNK_CHARS = 6000;

/** A paragraph of a chunk, with the pages of the unit it came from. */
type Paragraph = { text: string; pageFrom: number; pageTo: number };

type OpenChunk = {
  label: ChunkLabel;
  chapterPosition: number;
  paragraphs: Paragraph[];
};

/** Heading marks a heading's text may still carry: `#`s or bold. */
const HEADING_MARKS = /^\s*#+\s*|^\s*\*\*|\*\*\s*$/g;

const headingText = (markdown: string) =>
  markdown.replaceAll(HEADING_MARKS, "").trim();

function paragraphs(unit: BatchUnit, markdown = unit.markdown): Paragraph[] {
  return markdown
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, pageFrom: unit.pageFrom, pageTo: unit.pageTo }));
}

/**
 * The chunks of a Material's units, in reading order, cut at every
 * Chapter's start. Each unit is a chunk, except that a unit joins the one
 * before it across a batch edge when that one continues on the next batch,
 * it continues from the previous one, no heading or Chapter start stands
 * between them and their labels match. A Chapter's own heading becomes a
 * Markdown heading of the Chapter's depth at the start of the next unit;
 * any other heading becomes a bold line there. Headings with no unit after
 * them in their Chapter make a content chunk. A chunk over MAX_CHUNK_CHARS
 * splits between paragraphs. Without Chapters, every chunk is in the root.
 */
export function chunksFromUnits(
  units: readonly BatchUnit[],
  chapters: readonly ChapterStart[] = [],
): DraftChunk[] {
  const starts = Map.groupBy(
    chapters.toSorted((a, b) => a.position - b.position),
    (chapter) => chapter.startUnit,
  );
  const chunks: OpenChunk[] = [];
  let chapterPosition = 0;
  let headings: Paragraph[] = [];
  let previous: BatchUnit | null = null;
  const flushHeadings = () => {
    if (headings.length > 0) {
      chunks.push({ label: "content", chapterPosition, paragraphs: headings });
    }
    headings = [];
  };

  units.forEach((unit, index) => {
    const starting = starts.get(index);
    if (starting) {
      flushHeadings();
      previous = null;
      chapterPosition = starting.at(-1)!.position;
    }
    if (unit.label === "heading") {
      const own = starting?.find((chapter) => chapter.startsAtHeading);
      const text = headingText(unit.markdown);
      const line = own
        ? `${"#".repeat(Math.min(Math.max(own.depth, 1), 6))} ${text}`
        : `**${text}**`;
      headings.push(...paragraphs(unit, line));
      previous = null;
      return;
    }
    const open = chunks.at(-1);
    if (
      open &&
      previous?.continuesOnNextBatch &&
      unit.continuesFromPreviousBatch &&
      previous.label === unit.label
    ) {
      open.paragraphs.push(...paragraphs(unit));
    } else {
      chunks.push({
        label: unit.label,
        chapterPosition,
        paragraphs: [...headings, ...paragraphs(unit)],
      });
    }
    headings = [];
    previous = unit;
  });
  flushHeadings();

  return chunks
    .filter((chunk) => chunk.paragraphs.length > 0)
    .flatMap((chunk) =>
      splitParagraphs(chunk.paragraphs).map((part) => ({
        pageFrom: Math.min(...part.map((paragraph) => paragraph.pageFrom)),
        pageTo: Math.max(...part.map((paragraph) => paragraph.pageTo)),
        label: chunk.label,
        markdown: part.map((paragraph) => paragraph.text).join("\n\n"),
        chapterPosition: chunk.chapterPosition,
      })),
    );
}

/** Paragraphs in runs of at most MAX_CHUNK_CHARS, each run at least one. */
function splitParagraphs(all: Paragraph[]): Paragraph[][] {
  const runs: Paragraph[][] = [];
  let run: Paragraph[] = [];
  let length = 0;
  for (const paragraph of all) {
    const added = (run.length > 0 ? 2 : 0) + paragraph.text.length;
    if (run.length > 0 && length + added > MAX_CHUNK_CHARS) {
      runs.push(run);
      run = [];
      length = 0;
    }
    length += (run.length > 0 ? 2 : 0) + paragraph.text.length;
    run.push(paragraph);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}
