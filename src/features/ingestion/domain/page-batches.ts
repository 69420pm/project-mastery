import type { HEADING_STYLES, UnitLabel } from "@/features/ingestion/types";

/** A unit of a page batch, as code places and joins it. */
export type BatchUnit = {
  markdown: string;
  label: UnitLabel;
  pageFrom: number;
  pageTo: number;
  style: (typeof HEADING_STYLES)[number] | null;
  continuesFromPreviousBatch: boolean;
  continuesOnNextBatch: boolean;
};

/** The most pages one batch call reads. */
export const PAGES_PER_BATCH = 5;

/** Pages that need a call, in order, cut into batches of PAGES_PER_BATCH. */
export function pageBatches(pages: readonly number[]): number[][] {
  const batches: number[][] = [];
  for (let start = 0; start < pages.length; start += PAGES_PER_BATCH) {
    batches.push(pages.slice(start, start + PAGES_PER_BATCH));
  }
  return batches;
}

/**
 * The pages no unit covers, by its `pageFrom..pageTo`, in order: read
 * again alone, and stored `uncovered` when still none does.
 */
export function uncoveredPages(
  units: ReadonlyArray<Pick<BatchUnit, "pageFrom" | "pageTo">>,
  pages: readonly number[],
): number[] {
  return pages
    .filter(
      (page) =>
        !units.some((unit) => unit.pageFrom <= page && page <= unit.pageTo),
    )
    .toSorted((a, b) => a - b);
}

/**
 * A batch's units on its pages: each page with the units that start on it,
 * in order, and an empty list for a page where none does. A unit's pages
 * are kept inside the batch: it starts on the last batch page at or before
 * the page it gave (the first page when none is), and ends no earlier than
 * it starts and no later than the last page. Only a heading keeps a style,
 * only the first unit continues from the previous batch and only the last
 * continues on the next, so the flags mark batch edges alone.
 */
export function unitsOnPages<Unit extends BatchUnit>(
  units: readonly Unit[],
  pages: readonly number[],
): Map<number, Unit[]> {
  const sorted = pages.toSorted((a, b) => a - b);
  const first = sorted[0] ?? 1;
  const last = sorted.at(-1) ?? first;
  const onPages = new Map(sorted.map((page) => [page, [] as Unit[]]));
  units.forEach((unit, index) => {
    const pageFrom = sorted.findLast((page) => page <= unit.pageFrom) ?? first;
    onPages.get(pageFrom)?.push({
      ...unit,
      pageFrom,
      pageTo: Math.min(Math.max(unit.pageTo, pageFrom), last),
      style: unit.label === "heading" ? unit.style : null,
      continuesFromPreviousBatch:
        index === 0 && unit.continuesFromPreviousBatch,
      continuesOnNextBatch:
        index === units.length - 1 && unit.continuesOnNextBatch,
    });
  });
  return onPages;
}
