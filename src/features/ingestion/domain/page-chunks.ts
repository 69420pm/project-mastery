import type { ChunkLabel } from "@/features/ingestion/types";

/** A unit of a stored page result, as far as chunks need it. */
type StoredUnit = {
  markdown: string;
  label: ChunkLabel;
  exerciseNumber: string | null;
  points: number | null;
  figure: { description: string } | null;
};

/** A chunk before it is stored. */
export type NewChunk = {
  position: number;
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
  figure: { description: string; cropPath: string | null } | null;
  exerciseNumber: string | null;
  points: number | null;
};

/**
 * One chunk per unit, in page order and then in the order of the page's
 * units, each on its own page. Merging units across pages comes later.
 */
export function chunksFromPages(
  pages: ReadonlyArray<{ pageNumber: number; units: readonly StoredUnit[] }>,
): NewChunk[] {
  return pages
    .toSorted((a, b) => a.pageNumber - b.pageNumber)
    .flatMap(({ pageNumber, units }) =>
      units.map((unit) => ({ pageNumber, unit })),
    )
    .map(({ pageNumber, unit }, position) => ({
      position,
      pageFrom: pageNumber,
      pageTo: pageNumber,
      label: unit.label,
      markdown: unit.markdown,
      figure: unit.figure && {
        description: unit.figure.description,
        cropPath: null,
      },
      exerciseNumber: unit.exerciseNumber,
      points: unit.points,
    }));
}
