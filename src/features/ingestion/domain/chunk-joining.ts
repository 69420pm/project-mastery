import type { ChunkLabel } from "@/features/ingestion/types";

/** A unit of a read page, as joining sees it. */
export type JoinUnit = {
  markdown: string;
  label: ChunkLabel;
  exerciseNumber: string | null;
  continuesFromPreviousPage: boolean;
  continuesOnNextPage: boolean;
};

/** A read page's units, in reading order. */
export type JoinPage = { pageNumber: number; units: JoinUnit[] };

/** A chunk made of one unit or of units joined across page breaks. */
export type DraftChunk = {
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
  exerciseNumber: string | null;
};

/** The longest a joined chunk may get, in characters. */
export const MAX_CHUNK_CHARS = 6000;

/** The most pages a joined chunk may span. */
export const MAX_CHUNK_PAGES = 3;

/** Text that closes a thought: sentence or colon end, or display formula. */
const CLOSED_END = /(?:[.!?:]|\$\$|\\\])$/;

/** A subtask label such as `b)`, `(b)` or `(ii)` at the start. */
const SUBTASK_START = /^\(?(?:[a-z]|[ivx]+)\)/i;

/** Markdown emphasis around the text, which says nothing about its end. */
const EMPHASIS = /^[\s*_]+|[\s*_]+$/g;

/** Whether the text of two units says the later one goes on the earlier. */
function textContinues(earlier: string, later: string): boolean {
  const end = earlier.replace(EMPHASIS, "");
  const start = later.replace(EMPHASIS, "");
  return (
    !CLOSED_END.test(end) || /^\p{Ll}/u.test(start) || SUBTASK_START.test(start)
  );
}

/**
 * The chunks of a Material's read pages, ordered by their first unit. A
 * non-admin unit joins the previous non-admin unit's chunk when that unit
 * is on the page before, a continuation flag says so, and the text agrees;
 * a join stops before the chunk passes MAX_CHUNK_CHARS or spans more than
 * MAX_CHUNK_PAGES. Admin units never join and never break a join. A joined
 * chunk keeps its first unit's label and first exercise number.
 */
export function joinUnits(pages: JoinPage[]): DraftChunk[] {
  const chunks: DraftChunk[] = [];
  let open: { chunk: DraftChunk; last: JoinUnit; page: number } | null = null;
  for (const { pageNumber, units } of pages) {
    for (const unit of units) {
      if (unit.label === "admin") {
        chunks.push(draft(unit, pageNumber));
        continue;
      }
      if (open && joins(open, unit, pageNumber)) {
        open.chunk.markdown = `${open.chunk.markdown}\n\n${unit.markdown}`;
        open.chunk.pageTo = pageNumber;
        open.chunk.exerciseNumber ??= storableNumber(unit.exerciseNumber);
        open.last = unit;
        open.page = pageNumber;
        continue;
      }
      const chunk = draft(unit, pageNumber);
      chunks.push(chunk);
      open = { chunk, last: unit, page: pageNumber };
    }
  }
  return chunks;
}

function draft(unit: JoinUnit, pageNumber: number): DraftChunk {
  return {
    pageFrom: pageNumber,
    pageTo: pageNumber,
    label: unit.label,
    markdown: unit.markdown,
    exerciseNumber: storableNumber(unit.exerciseNumber),
  };
}

/** The column holds 1 to 50 characters; an empty or longer answer is no number. */
function storableNumber(exerciseNumber: string | null): string | null {
  const trimmed = exerciseNumber?.trim() ?? "";
  return trimmed.length > 0 && trimmed.length <= 50 ? trimmed : null;
}

function joins(
  open: { chunk: DraftChunk; last: JoinUnit; page: number },
  unit: JoinUnit,
  pageNumber: number,
): boolean {
  return (
    pageNumber === open.page + 1 &&
    (open.last.continuesOnNextPage || unit.continuesFromPreviousPage) &&
    textContinues(open.last.markdown, unit.markdown) &&
    open.chunk.markdown.length + 2 + unit.markdown.length <= MAX_CHUNK_CHARS &&
    pageNumber - open.chunk.pageFrom < MAX_CHUNK_PAGES
  );
}
