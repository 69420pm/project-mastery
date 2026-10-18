import type { NormalizedBox } from "@/features/ingestion/domain/figure-box";
import type { ChunkLabel } from "@/features/ingestion/types";

/**
 * A chunk's figure: where it is in the Material's file, a page and a box on
 * it, or the whole page without a box.
 */
type ChunkFigure = {
  description: string;
  page: number;
  box: NormalizedBox | null;
};

/** A chunk before it is stored. */
export type NewChunk = {
  position: number;
  pageFrom: number;
  pageTo: number;
  label: ChunkLabel;
  markdown: string;
  figure: ChunkFigure | null;
  exerciseNumber: string | null;
  points: number | null;
};

/** A unit of a stored page result, as far as chunks need it. */
export type StoredUnit = {
  markdown: string;
  label: ChunkLabel;
  exerciseNumber: string | null;
  points: number | null;
  /** `box` is null when the figure has no usable box: it is the whole page. */
  figure: { description: string; box: NormalizedBox | null } | null;
  continuesFromPreviousPage: boolean;
  continuesOnNextPage: boolean;
};

/** A unit of the whole Material, with the id the file call refers to it by. */
export type MaterialUnit = {
  id: string;
  pageNumber: number;
  unit: StoredUnit;
};

/** One chunk of the file call's result: neighbouring units under one label. */
export type FileChunk = {
  unitIds: readonly string[];
  label: ChunkLabel;
  exerciseNumber: string | null;
  points: number | null;
};

/**
 * Stands in for the units of a page the page call found nothing on (blank,
 * or only a logo), so a chunk covers every page.
 */
const EMPTY_PAGE_UNIT: StoredUnit = {
  markdown: "This page has no content.",
  label: "admin",
  exerciseNumber: null,
  points: null,
  figure: null,
  continuesFromPreviousPage: false,
  continuesOnNextPage: false,
};

/**
 * Every unit of a Material in reading order, by page and then by its place
 * on the page, each with an id such as `p2u1` (page 2, first unit). A page
 * without units gets one admin unit saying so.
 */
export function materialUnits(
  pages: ReadonlyArray<{ pageNumber: number; units: readonly StoredUnit[] }>,
): MaterialUnit[] {
  return pages
    .toSorted((a, b) => a.pageNumber - b.pageNumber)
    .flatMap(({ pageNumber, units }) =>
      (units.length > 0 ? units : [EMPTY_PAGE_UNIT]).map((unit, index) => ({
        id: `p${pageNumber}u${index + 1}`,
        pageNumber,
        unit,
      })),
    );
}

function unitIndexes(units: readonly MaterialUnit[]): Map<string, number> {
  return new Map(units.map((unit, index) => [unit.id, index]));
}

/** A chunk's existing units in reading order, with their place in `units`. */
function membersOf(
  chunk: FileChunk,
  units: readonly MaterialUnit[],
  indexOf: ReadonlyMap<string, number>,
): Array<{ index: number; unit: MaterialUnit }> {
  return chunk.unitIds
    .flatMap((id) => {
      const index = indexOf.get(id);
      const unit = index === undefined ? undefined : units[index];
      return index !== undefined && unit ? [{ index, unit }] : [];
    })
    .toSorted((a, b) => a.index - b.index);
}

/**
 * What is wrong with a file call's chunks, empty when nothing is: every
 * chunk joins neighbouring units, every unit lands in exactly one chunk, and
 * every page lies in some chunk's page range.
 */
export function coverageProblems(
  units: readonly MaterialUnit[],
  chunks: readonly FileChunk[],
  pageNumbers: readonly number[],
): string[] {
  const indexOf = unitIndexes(units);
  const problems: string[] = [];
  const placed = new Map<string, number>();
  const ranges: Array<[number, number]> = [];

  for (const chunk of chunks) {
    if (chunk.unitIds.length === 0) {
      problems.push("A chunk has no units.");
      continue;
    }
    for (const id of chunk.unitIds) {
      if (indexOf.has(id)) placed.set(id, (placed.get(id) ?? 0) + 1);
      else problems.push(`Unit ${id} does not exist.`);
    }
    const members = membersOf(chunk, units, indexOf);
    const neighbours = members.every(
      (member, i) =>
        i === 0 || member.index - (members[i - 1]?.index ?? 0) <= 1,
    );
    if (!neighbours) {
      problems.push(
        `A chunk joins units that are not neighbours: ${chunk.unitIds.join(", ")}.`,
      );
    }
    const first = members[0];
    const last = members.at(-1);
    if (first && last) {
      ranges.push([first.unit.pageNumber, last.unit.pageNumber]);
    }
  }

  for (const { id } of units) {
    const count = placed.get(id) ?? 0;
    if (count === 0) problems.push(`Unit ${id} is in no chunk.`);
    if (count > 1) problems.push(`Unit ${id} is in ${count} chunks.`);
  }
  for (const page of pageNumbers) {
    if (!ranges.some(([from, to]) => from <= page && page <= to)) {
      problems.push(`Page ${page} is in no chunk.`);
    }
  }
  return problems;
}

/**
 * The chunks to store from a file call's chunks that passed
 * `coverageProblems`, in reading order. A chunk's markdown is its units'
 * markdown joined, not regenerated, and its pages and figure come from its
 * units. A chunk has one figure: the place of its first figure, described by
 * the descriptions of all its units' figures, so none is lost.
 */
export function chunksFromFileResult(
  units: readonly MaterialUnit[],
  chunks: readonly FileChunk[],
): NewChunk[] {
  const indexOf = unitIndexes(units);
  return chunks
    .flatMap((chunk) => {
      const members = membersOf(chunk, units, indexOf).map(({ unit }) => unit);
      const first = members[0];
      const last = members.at(-1);
      return first && last ? [{ chunk, members, first, last }] : [];
    })
    .toSorted(
      (a, b) => (indexOf.get(a.first.id) ?? 0) - (indexOf.get(b.first.id) ?? 0),
    )
    .map(({ chunk, members, first, last }, position) => {
      const figures = members.flatMap(({ pageNumber, unit }) =>
        unit.figure ? [{ pageNumber, ...unit.figure }] : [],
      );
      const figure = figures[0];
      return {
        position,
        pageFrom: first.pageNumber,
        pageTo: last.pageNumber,
        label: chunk.label,
        markdown: members.map(({ unit }) => unit.markdown).join("\n\n"),
        figure: figure
          ? {
              description: figures
                .map(({ description }) => description)
                .join("\n\n"),
              page: figure.pageNumber,
              box: figure.box,
            }
          : null,
        exerciseNumber: chunk.exerciseNumber,
        points: chunk.points,
      };
    });
}
