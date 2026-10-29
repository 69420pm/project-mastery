/** An entry of a PDF's outline, in document order. */
export type OutlineEntry = {
  title: string;
  /** 1 for a top-level entry. */
  level: number;
  /** The 1-based page it points at. */
  page: number;
};

/**
 * A Material's chapter level: the shallowest outline level with at least 3
 * entries, or else the level with the most entries (the shallower on a
 * tie). Null without an outline.
 */
export function chapterLevel(outline: OutlineEntry[]): number | null {
  const counts = new Map<number, number>();
  for (const entry of outline) {
    counts.set(entry.level, (counts.get(entry.level) ?? 0) + 1);
  }
  const levels = [...counts.keys()].sort((a, b) => a - b);
  return (
    levels.find((level) => (counts.get(level) ?? 0) >= 3) ??
    levels.reduce<number | null>(
      (best, level) =>
        best === null || (counts.get(level) ?? 0) > (counts.get(best) ?? 0)
          ? level
          : best,
      null,
    )
  );
}

/** A Markdown heading of level 1 (`# Title`). */
const LEVEL_ONE_HEADING = /^# +(.+?)\s*#*\s*$/gm;

/**
 * The chapter title of each chunk, in order: the outline entry at the
 * chapter level that covers its first page, else the deepest entry above
 * that level that covers it, else the last level-1 Markdown heading up to
 * and including the chunk, else the Material's name. An entry covers the
 * pages from its own until the next entry at its level or above.
 */
export function chunkChapters(
  chunks: { pageFrom: number; markdown: string }[],
  outline: OutlineEntry[],
  materialName: string,
): string[] {
  const level = chapterLevel(outline);
  let heading: string | null = null;
  return chunks.map((chunk) => {
    for (const match of chunk.markdown.matchAll(LEVEL_ONE_HEADING)) {
      heading = match[1] ?? heading;
    }
    if (level !== null) {
      const covering = coveringEntries(outline, chunk.pageFrom);
      const entry =
        covering.get(level) ??
        [...covering.entries()]
          .filter(([entryLevel]) => entryLevel < level)
          .sort(([a], [b]) => b - a)[0]?.[1];
      if (entry) return entry.title;
    }
    return heading ?? materialName;
  });
}

/** The outline entries that cover a page, by level. */
function coveringEntries(
  outline: OutlineEntry[],
  page: number,
): Map<number, OutlineEntry> {
  const covering = new Map<number, OutlineEntry>();
  for (const entry of outline) {
    if (entry.page > page) break;
    for (const level of covering.keys()) {
      if (level >= entry.level) covering.delete(level);
    }
    covering.set(entry.level, entry);
  }
  return covering;
}
