import type { BatchUnit } from "@/features/ingestion/domain/page-batches";
import type { ChunkLabel } from "@/features/ingestion/types";

/** A chunk made of one unit or of units joined across a batch edge. */
export type DraftChunk = {
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
};

/** The longest a chunk gets, in characters, unless one paragraph is longer. */
export const MAX_CHUNK_CHARS = 6000;

/** A paragraph of a chunk, with the pages of the unit it came from. */
type Paragraph = { text: string; pageFrom: number; pageTo: number };

type OpenChunk = { label: ChunkLabel; paragraphs: Paragraph[] };

/** Heading marks a heading's text may still carry: `#`s or bold. */
const HEADING_MARKS = /^\s*#+\s*|^\s*\*\*|\*\*\s*$/g;

/** A heading's text as a bold line. */
function boldLine(markdown: string): string {
  return `**${markdown.replaceAll(HEADING_MARKS, "").trim()}**`;
}

function paragraphs(unit: BatchUnit, markdown = unit.markdown): Paragraph[] {
  return markdown
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, pageFrom: unit.pageFrom, pageTo: unit.pageTo }));
}

/**
 * The chunks of a Material's units, in reading order. Each unit is a chunk,
 * except that a unit joins the one before it across a batch edge when that
 * one continues on the next batch, it continues from the previous one, no
 * heading stands between them and their labels match. A heading becomes a
 * bold line at the start of the next unit; headings with no unit after them
 * make a content chunk. A chunk over MAX_CHUNK_CHARS splits between
 * paragraphs.
 */
export function chunksFromUnits(units: readonly BatchUnit[]): DraftChunk[] {
  const chunks: OpenChunk[] = [];
  let headings: BatchUnit[] = [];
  let previous: BatchUnit | null = null;
  for (const unit of units) {
    if (unit.label === "heading") {
      headings.push(unit);
      previous = null;
      continue;
    }
    const label = unit.label;
    const open = chunks.at(-1);
    if (
      open &&
      previous?.continuesOnNextBatch &&
      unit.continuesFromPreviousBatch &&
      previous.label === label
    ) {
      open.paragraphs.push(...paragraphs(unit));
    } else {
      chunks.push({
        label,
        paragraphs: [
          ...headings.flatMap((heading) =>
            paragraphs(heading, boldLine(heading.markdown)),
          ),
          ...paragraphs(unit),
        ],
      });
    }
    headings = [];
    previous = unit;
  }
  if (headings.length > 0) {
    chunks.push({
      label: "content",
      paragraphs: headings.flatMap((heading) =>
        paragraphs(heading, boldLine(heading.markdown)),
      ),
    });
  }
  return chunks
    .filter((chunk) => chunk.paragraphs.length > 0)
    .flatMap((chunk) =>
      splitParagraphs(chunk.paragraphs).map((part) => ({
        pageFrom: Math.min(...part.map((paragraph) => paragraph.pageFrom)),
        pageTo: Math.max(...part.map((paragraph) => paragraph.pageTo)),
        label: chunk.label,
        markdown: part.map((paragraph) => paragraph.text).join("\n\n"),
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
