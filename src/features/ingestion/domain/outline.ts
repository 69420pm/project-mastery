import type { BatchUnit } from "@/features/ingestion/domain/page-batches";

/**
 * A Material's Outline: the Chapter tree the structure call of a parse
 * proposes from all of its headings, checked here against its units.
 */

/** A Chapter as the structure call proposes it, in reading order. */
export type ProposedChapter = {
  title: string;
  /** 1 for a top-level Chapter, 2 for one inside it, and so on. */
  level: number;
  /** The id of the heading unit it starts at (`headingIds`), if any. */
  heading: string | null;
  /** The page it starts on, when it starts at no heading. */
  page: number | null;
  /** An old exam, a class test or its solutions. */
  exam: boolean;
};

/** A Chapter of the stored Outline. */
export type OutlineChapter = {
  /** 0-based in reading order; the root is 0. */
  position: number;
  parentPosition: number | null;
  /** 0 for the root. */
  depth: number;
  title: string;
  pageFrom: number;
  examProposed: boolean;
  /** The index of the unit it starts at. */
  startUnit: number;
  /** Whether that unit is its heading. */
  startsAtHeading: boolean;
};

/** The longest a Chapter title gets (`chapters.title`). */
const MAX_TITLE_CHARS = 500;

/**
 * The ids the structure call knows the heading units by: `h1`, `h2`, … in
 * reading order, each with the index of its unit.
 */
export function headingIds(
  units: readonly Pick<BatchUnit, "label">[],
): Map<string, number> {
  const ids = new Map<string, number>();
  units.forEach((unit, index) => {
    if (unit.label === "heading") ids.set(`h${ids.size + 1}`, index);
  });
  return ids;
}

/**
 * The Outline of a Material: the root Chapter, titled by its name, and the
 * proposed Chapters below it. A Chapter starts at its heading; with an
 * unknown or already used heading id, at the first unit that starts on its
 * page; given by a page where no unit starts, at the first unit after it,
 * if that is before the next Chapter's start. A Chapter with none of these, without a title, or starting before the
 * Chapter kept before it is dropped. A Chapter's parent is the nearest
 * Chapter kept before it with a lower level, so its depth is one more than
 * that parent's.
 */
export function outlineChapters(
  materialName: string,
  units: readonly Pick<BatchUnit, "label" | "pageFrom">[],
  proposed: readonly ProposedChapter[],
): OutlineChapter[] {
  const ids = headingIds(units);
  const used = new Set<string>();
  const root: OutlineChapter = {
    position: 0,
    parentPosition: null,
    depth: 0,
    title: materialName.slice(0, MAX_TITLE_CHARS),
    pageFrom: 1,
    examProposed: false,
    startUnit: 0,
    startsAtHeading: false,
  };
  const kept = [root];
  const levels = [0];
  // The start each Chapter has at its heading or on a page with a unit.
  const seen = new Set<string>();
  const exact = proposed.map((chapter): number | undefined => {
    if (!chapter.title.trim()) return undefined;
    if (
      chapter.heading !== null &&
      ids.has(chapter.heading) &&
      !seen.has(chapter.heading)
    ) {
      seen.add(chapter.heading);
      return ids.get(chapter.heading);
    }
    if (chapter.page === null) return undefined;
    const index = units.findIndex((unit) => unit.pageFrom === chapter.page);
    return index === -1 ? undefined : index;
  });
  for (const [at, chapter] of proposed.entries()) {
    const title = chapter.title.trim().slice(0, MAX_TITLE_CHARS);
    if (!title) continue;
    let startUnit: number | undefined;
    let startsAtHeading = false;
    if (
      chapter.heading !== null &&
      ids.has(chapter.heading) &&
      !used.has(chapter.heading)
    ) {
      startUnit = ids.get(chapter.heading)!;
      startsAtHeading = true;
      used.add(chapter.heading);
    } else if (chapter.page !== null) {
      const index = units.findIndex((unit) => unit.pageFrom === chapter.page);
      if (index !== -1) {
        startUnit = index;
      } else if (chapter.page !== null) {
        // A page without a unit (a title page, say): the first unit after
        // it, if that comes before the next Chapter's start.
        const next = exact.slice(at + 1).find((start) => start !== undefined);
        const after = units.findIndex((unit) => unit.pageFrom > chapter.page!);
        if (after !== -1 && (next === undefined || after < next)) {
          startUnit = after;
        }
      }
    }
    if (startUnit === undefined || startUnit < kept.at(-1)!.startUnit) {
      continue;
    }
    const level = Math.max(1, Math.trunc(chapter.level));
    let parent = kept.length - 1;
    while (levels[parent]! >= level) parent -= 1;
    kept.push({
      position: kept.length,
      parentPosition: kept[parent]!.position,
      depth: kept[parent]!.depth + 1,
      title,
      pageFrom: units[startUnit]!.pageFrom,
      examProposed: chapter.exam,
      startUnit,
      startsAtHeading,
    });
    levels.push(level);
  }
  return kept;
}

/**
 * The Chapters a PDF outline proposes, when the structure call failed: each
 * entry starts on its page, at no heading.
 */
export function chaptersFromPdfOutline(
  entries: readonly { title: string; level: number; page: number }[],
): ProposedChapter[] {
  return entries.map((entry) => ({
    title: entry.title,
    level: entry.level,
    heading: null,
    page: entry.page,
    exam: false,
  }));
}
