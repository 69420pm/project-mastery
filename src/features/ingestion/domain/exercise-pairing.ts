/**
 * Pairing exercises with their solutions across a Course, the part done in
 * code (#228): which chunks each pairing call sees, the short ids it sees
 * them by, and the checks on its answer.
 */

/** An exercise or solution chunk of a Course, as pairing sees it. */
export type PairingChunk = { id: string; label: "exercise" | "solution" };

/** The most exercise and solution chunks one pairing call sees. */
export const MAX_PAIRING_CHUNKS = 400;

/**
 * The chunks of each pairing call: the Course's exercise and solution
 * chunks, in Course order, in runs of at most `size`. A run without an
 * exercise or without a solution needs no call and is left out.
 */
export function pairingCalls<Chunk extends PairingChunk>(
  chunks: Chunk[],
  size = MAX_PAIRING_CHUNKS,
): Chunk[][] {
  const runs: Chunk[][] = [];
  for (let start = 0; start < chunks.length; start += size) {
    runs.push(chunks.slice(start, start + size));
  }
  return runs.filter(
    (run) =>
      run.some((chunk) => chunk.label === "exercise") &&
      run.some((chunk) => chunk.label === "solution"),
  );
}

/**
 * The ids a call sees its chunks by: e1, e2, … for the exercises and s1,
 * s2, … for the solutions, in order. Maps each to its chunk.
 */
export function offeredIds<Chunk extends PairingChunk>(
  chunks: Chunk[],
): Map<string, Chunk> {
  const offered = new Map<string, Chunk>();
  let exercises = 0;
  let solutions = 0;
  for (const chunk of chunks) {
    const id =
      chunk.label === "exercise" ? `e${++exercises}` : `s${++solutions}`;
    offered.set(id, chunk);
  }
  return offered;
}

/** A pair as the call answers it, by offered ids. */
export type AnsweredPair = { exerciseId: string; solutionId: string };

/**
 * The solution chunk of each exercise chunk the answer pairs: an id that
 * names no offered exercise, or no offered solution, is dropped, and an
 * exercise keeps the first solution the answer gives it.
 */
export function checkedPairs(
  pairs: AnsweredPair[],
  offered: Map<string, PairingChunk>,
): Map<string, string> {
  const solutionOf = new Map<string, string>();
  for (const pair of pairs) {
    const exercise = offered.get(pair.exerciseId.trim());
    const solution = offered.get(pair.solutionId.trim());
    if (exercise?.label !== "exercise" || solution?.label !== "solution") {
      continue;
    }
    if (!solutionOf.has(exercise.id)) solutionOf.set(exercise.id, solution.id);
  }
  return solutionOf;
}

/** A Chapter of a Material's Outline, as a Chapter path reads it. */
export type PathChapter = {
  parentId: string | null;
  depth: number;
  title: string;
};

/**
 * The titles from the top Chapter below the root down to this one, such as
 * ["4 Vector Spaces", "4.2 Subspaces"]; empty for the root or no Chapter.
 */
export function chapterPath(
  chapterId: string | null,
  chapters: Map<string, PathChapter>,
): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  let id = chapterId;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const chapter = chapters.get(id);
    if (!chapter || chapter.depth === 0) break;
    titles.unshift(chapter.title);
    id = chapter.parentId;
  }
  return titles;
}
