import { createHash } from "node:crypto";

/**
 * The units the build extracts from (#229): a Chapter whose subtree's chunks
 * of one kind total at most UNIT_CHARS characters is one unit. A bigger
 * Chapter makes units of its children, plus units of its own chunks outside
 * them; chunks over the cap split between chunks. Sibling Chapters are never
 * packed into one unit. The same rule over a Material's `content` chunks
 * gives its teaching units, over its `exercise` chunks its exercise units.
 */

/**
 * The most characters of chunks in one unit. A call's time follows the KCs
 * it writes, and a slow model (MiMo) took over 170 s on 25,000 characters,
 * so a unit asks for about 15 KCs at most.
 */
export const UNIT_CHARS = 12_000;

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
 * `chapterIds` holds its one Chapter.
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
    for (const child of children.get(id) ?? []) visit(child.id);
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
