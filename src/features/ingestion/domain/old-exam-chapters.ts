/**
 * Old exams are Chapters the Student confirmed in the Brief. A confirmed
 * Chapter covers its subtree, so an exam inside a script counts.
 */

/** A Chapter as the old-exam rules read it. */
export type ExamChapterNode = {
  id: string;
  parentId: string | null;
  /** Whether the Student confirmed it as an old exam. */
  isExam: boolean;
};

/**
 * The Chapters inside an old exam: each confirmed Chapter and every
 * Chapter below it. A Chapter whose parent is missing counts as a root.
 */
export function examChapterIds(
  chapters: readonly ExamChapterNode[],
): Set<string> {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const inExam = new Map<string, boolean>();
  const check = (id: string): boolean => {
    const known = inExam.get(id);
    if (known !== undefined) return known;
    const chapter = byId.get(id);
    // Marked before the walk up, so a cycle ends.
    inExam.set(id, false);
    const result =
      chapter !== undefined &&
      (chapter.isExam ||
        (chapter.parentId !== null && check(chapter.parentId)));
    inExam.set(id, result);
    return result;
  };
  return new Set(chapters.filter(({ id }) => check(id)).map(({ id }) => id));
}

/** A Chapter and every Chapter below it; empty when it is not among them. */
export function chapterSubtree(
  chapters: ReadonlyArray<Pick<ExamChapterNode, "id" | "parentId">>,
  rootId: string,
): Set<string> {
  if (!chapters.some(({ id }) => id === rootId)) return new Set();
  const subtree = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { id, parentId } of chapters) {
      if (parentId !== null && subtree.has(parentId) && !subtree.has(id)) {
        subtree.add(id);
        grew = true;
      }
    }
  }
  return subtree;
}
