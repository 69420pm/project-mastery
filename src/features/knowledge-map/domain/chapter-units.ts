import { createHash } from "node:crypto";

/**
 * The units the build extracts from (#229): a Chapter whose subtree's chunks
 * of one kind total at most UNIT_CHARS characters is one unit. A bigger
 * Chapter makes units of its children; its own chunks outside them join the
 * unit of its first child (alone only when they alone pass the cap), and
 * consecutive children that each fit are packed into one unit up to the cap.
 * Chunks over the cap split between chunks. The same rule over a Material's `content` chunks
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
 * A unit: its lead Chapter, its index among that Chapter's units, its
 * chunks. `chapterIds` holds every Chapter whose chunks it reads: a packed
 * unit's siblings, a first child's unit's parents.
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
  type Part = { ids: string[]; chunks: UnitChunk[] };
  const nothing: Part = { ids: [], chunks: [] };
  // A unit is named by its `lead` Chapter: the one it is the first unit of
  // or, for a packed unit, its first packed Chapter.
  const emit = (
    lead: string,
    ids: string[],
    list: readonly UnitChunk[],
    unit = 0,
  ) =>
    units.push({
      chapterId: lead,
      unit,
      chapterIds: ids,
      chunkIds: list
        .toSorted((a, b) => place.get(a.id)! - place.get(b.id)!)
        .map((c) => c.id),
    });
  // `carry` is what the Chapters above give this one: their own chunks.
  const visit = (id: string, carry: Part) => {
    const whole = [...carry.chunks, ...subtree(id)];
    const mine: Part = {
      ids: [...carry.ids, id],
      chunks: [...carry.chunks, ...(own.get(id) ?? [])],
    };
    if (whole.length === 0) return;
    if (size(whole) <= cap) {
      emit(id, mine.ids, whole);
      return;
    }
    const kids = (children.get(id) ?? [])
      .map((child) => ({ id: child.id, chunks: subtree(child.id) }))
      .filter((kid) => kid.chunks.length > 0);
    if (kids.length === 0 || size(mine.chunks) > cap) {
      slices(mine.chunks, cap).forEach((slice, unit) =>
        emit(id, mine.ids, slice, unit),
      );
    }
    if (kids.length === 0) return;
    // The Chapter's own chunks go with its first child, unless they were
    // units of their own above.
    // A Chapter without chunks of its own is not named by that unit.
    let extra: Part =
      size(mine.chunks) > cap
        ? nothing
        : {
            ids: own.has(id) ? mine.ids : carry.ids,
            chunks: mine.chunks,
          };
    // Consecutive children that fit are packed into units up to the cap.
    const open: { pack: (Part & { lead: string }) | null } = { pack: null };
    const flush = () => {
      if (open.pack) emit(open.pack.lead, open.pack.ids, open.pack.chunks);
      open.pack = null;
    };
    for (const kid of kids) {
      const { pack } = open;
      if (size(kid.chunks) + size(extra.chunks) > cap) {
        flush();
        visit(kid.id, extra);
      } else if (pack && size(pack.chunks) + size(kid.chunks) <= cap) {
        pack.ids.push(kid.id);
        pack.chunks.push(...kid.chunks);
      } else {
        flush();
        open.pack = {
          lead: kid.id,
          ids: [...extra.ids, kid.id],
          chunks: [...extra.chunks, ...kid.chunks],
        };
      }
      extra = nothing;
    }
    flush();
  };
  visit(root.id, nothing);
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
