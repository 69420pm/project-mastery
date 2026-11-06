import { createHash } from "node:crypto";

/**
 * The units the build extracts from (#229): a Chapter whose subtree's chunks
 * of one kind total at most UNIT_CHARS characters is one unit. A bigger
 * Chapter makes units of its children, plus units of its own chunks outside
 * them; chunks over the cap split between chunks. Consecutive children
 * under the cap are packed into one unit, up to the cap. The same rule over
 * a Material's `content` chunks gives its teaching units, over its
 * `exercise` chunks its exercise units.
 */

/**
 * The most characters of chunks in one unit: about 2 minutes of a call at
 * 4–5 ms per character, well inside CALL_TIMEOUT_MS.
 */
export const UNIT_CHARS = 25_000;

/** A Chapter of one Material's Outline, in reading order. */
export type UnitChapter = { id: string; parentId: string | null };

/** A chunk of one Material, in reading order. */
export type UnitChunk = {
  id: string;
  chapterId: string | null;
  markdown: string;
};

/**
 * A unit: its Chapter, its index among that Chapter's units, its chunks.
 * A packed unit's Chapter is the first of the sibling Chapters it holds,
 * all of which are in `chapterIds`.
 */
export type ChapterUnit = {
  chapterId: string;
  unit: number;
  chapterIds: string[];
  chunkIds: string[];
};

/**
 * The units of one Material's chunks of one kind, in reading order. A chunk
 * without a Chapter counts as its Material's root Chapter's.
 */
export function chapterUnits(
  chapters: readonly UnitChapter[],
  chunks: readonly UnitChunk[],
  cap = UNIT_CHARS,
): ChapterUnit[] {
  const root = chapters.find((chapter) => chapter.parentId === null);
  if (!root) return [];
  const known = new Set(chapters.map((chapter) => chapter.id));
  const place = new Map(chunks.map((chunk, index) => [chunk.id, index]));
  const own = Map.groupBy(chunks, (chunk) =>
    chunk.chapterId && known.has(chunk.chapterId) ? chunk.chapterId : root.id,
  );
  const children = Map.groupBy(
    chapters.filter((chapter) => chapter.parentId !== null),
    (chapter) => chapter.parentId!,
  );
  const subtree = (id: string): UnitChunk[] =>
    [
      ...(own.get(id) ?? []),
      ...(children.get(id) ?? []).flatMap((child) => subtree(child.id)),
    ].toSorted((a, b) => place.get(a.id)! - place.get(b.id)!);
  const size = (list: readonly UnitChunk[]) =>
    list.reduce((sum, chunk) => sum + chunk.markdown.length, 0);

  const units: ChapterUnit[] = [];
  const visit = (id: string) => {
    const whole = subtree(id);
    if (whole.length === 0) return;
    if (size(whole) <= cap) {
      units.push({
        chapterId: id,
        unit: 0,
        chapterIds: [id],
        chunkIds: whole.map((c) => c.id),
      });
      return;
    }
    slices(own.get(id) ?? [], cap).forEach((slice, unit) =>
      units.push({
        chapterId: id,
        unit,
        chapterIds: [id],
        chunkIds: slice.map((c) => c.id),
      }),
    );
    // Consecutive children under the cap, packed up to the cap.
    let pack: { ids: string[]; chunks: UnitChunk[] } | null = null;
    const flush = () => {
      if (!pack) return;
      units.push({
        chapterId: pack.ids[0]!,
        unit: 0,
        chapterIds: pack.ids,
        chunkIds: pack.chunks.map((c) => c.id),
      });
      pack = null;
    };
    for (const child of children.get(id) ?? []) {
      const chunks = subtree(child.id);
      if (chunks.length === 0) continue;
      if (size(chunks) > cap) {
        flush();
        visit(child.id);
        continue;
      }
      if (pack && size(pack.chunks) + size(chunks) > cap) flush();
      pack ??= { ids: [], chunks: [] };
      pack.ids.push(child.id);
      pack.chunks.push(...chunks);
    }
    flush();
  };
  visit(root.id);
  return units.toSorted(
    (a, b) => place.get(a.chunkIds[0]!)! - place.get(b.chunkIds[0]!)!,
  );
}

/** Chunks in runs of at most `cap` characters, split between chunks. */
function slices(chunks: readonly UnitChunk[], cap: number): UnitChunk[][] {
  const runs: UnitChunk[][] = [];
  let run: UnitChunk[] = [];
  let chars = 0;
  for (const chunk of chunks) {
    if (run.length > 0 && chars + chunk.markdown.length > cap) {
      runs.push(run);
      run = [];
      chars = 0;
    }
    run.push(chunk);
    chars += chunk.markdown.length;
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * A unit's content hash: of its Chapter's title and its chunks' Markdown,
 * so an unchanged unit is not extracted again.
 */
export function unitHash(title: string, markdowns: readonly string[]): string {
  return createHash("sha256")
    .update([title, ...markdowns].join("\u0000"))
    .digest("hex");
}
