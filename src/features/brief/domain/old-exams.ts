import type { BriefChapter, ExamChapter } from "@/features/brief/domain/intake";

/**
 * Old exams are Chapters of the Materials' Outlines, which the Student
 * confirms in the Brief. A confirmed Chapter covers its subtree, so an
 * exam inside a script counts.
 */

/** Words in a Material's name that make it a likely old exam. */
const LIKELY_EXAM = /klausur|exam|prüfung|resit/i;

/**
 * Whether a Material's name marks it as a likely old exam, such as
 * "Altklausur 2023" or "Resit exam". The Student still confirms it.
 */
export function isLikelyExam(name: string): boolean {
  return LIKELY_EXAM.test(name);
}

/** A Material's Chapter as the Brief loads it, in reading order. */
export type StoredChapter = {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  /** The parse's structure call took it for an old exam. */
  examProposed: boolean;
  exam: boolean | null;
  examAsked: boolean;
};

/**
 * Whether the Brief proposes a Chapter as an old exam: the parse took it
 * for one, or it is a Material's root Chapter, titled by the Material's
 * name, and the name looks like one.
 */
export function proposedExam(
  chapter: Pick<StoredChapter, "title" | "depth" | "examProposed">,
): boolean {
  return (
    chapter.examProposed || (chapter.depth === 0 && isLikelyExam(chapter.title))
  );
}

/** "<Material> › <Chapter>", or the Material's name for its root Chapter. */
export function examChapterName(
  materialName: string,
  chapter: Pick<StoredChapter, "title" | "depth">,
): string {
  return chapter.depth === 0
    ? materialName
    : `${materialName} › ${chapter.title}`;
}

/** The deepest Chapter the Brief's context lists for every Material. */
const LISTED_DEPTH = 2;

/**
 * A Material's Chapters as the Brief's context lists them: to depth 2, and
 * any deeper one that is proposed or answered as an old exam.
 */
export function briefChapters(chapters: StoredChapter[]): BriefChapter[] {
  return chapters
    .filter(
      (chapter) =>
        chapter.depth <= LISTED_DEPTH ||
        proposedExam(chapter) ||
        chapter.exam !== null,
    )
    .map(({ id, title, depth, exam, examAsked, ...chapter }) => ({
      id,
      title,
      depth,
      proposed: proposedExam({ title, depth, ...chapter }),
      exam,
      examAsked,
    }));
}

/**
 * The Course's old exams: every confirmed Chapter that is not inside
 * another, Materials in Course order, then Chapters in reading order.
 */
export function confirmedExams(
  materials: ReadonlyArray<{ name: string; chapters: StoredChapter[] }>,
): ExamChapter[] {
  return materials.flatMap(({ name, chapters }) => {
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const insideExam = (chapter: StoredChapter): boolean => {
      const parent = byId.get(chapter.parentId ?? "");
      return (
        parent !== undefined && (parent.exam === true || insideExam(parent))
      );
    };
    return chapters
      .filter((chapter) => chapter.exam === true && !insideExam(chapter))
      .map((chapter) => ({
        id: chapter.id,
        name: examChapterName(name, chapter),
      }));
  });
}

/**
 * The Chapters the static old-exam question asks about: proposed, not
 * asked and not answered yet, in the parsed Materials.
 */
export function unaskedExams(
  materials: ReadonlyArray<{
    name: string;
    parsed: boolean;
    chapters: StoredChapter[];
  }>,
): ExamChapter[] {
  return materials.flatMap(({ name, parsed, chapters }) =>
    parsed
      ? chapters
          .filter(
            (chapter) =>
              proposedExam(chapter) &&
              !chapter.examAsked &&
              chapter.exam === null,
          )
          .map((chapter) => ({
            id: chapter.id,
            name: examChapterName(name, chapter),
          }))
      : [],
  );
}

const OLD_EXAMS_PART = "data-old-exams";

/**
 * The part of the static old-exam question that lists the Chapters it
 * asks about. The model does not see data parts, and the page shows only
 * text.
 */
export function oldExamsPart(chapterIds: string[]) {
  return { type: OLD_EXAMS_PART, data: { chapterIds } };
}

/**
 * The Chapters the Student was asked about: those the static old-exam
 * questions in `messages` listed and, while intake runs, every Chapter of
 * the context, as the AI asks about them itself.
 */
export function askedChapterIds(
  messages: ReadonlyArray<{ parts: ReadonlyArray<{ type: string }> }>,
  intakeChapterIds: readonly string[],
): string[] {
  const listed = messages.flatMap(({ parts }) =>
    parts.flatMap((part) =>
      part.type === OLD_EXAMS_PART
        ? ((part as ReturnType<typeof oldExamsPart>).data.chapterIds ?? [])
        : [],
    ),
  );
  return [...new Set([...listed, ...intakeChapterIds])];
}

/**
 * The static question the Brief posts about Chapters that look like old
 * exams and were not asked about yet, each named "<Material> › <Chapter>".
 */
export function oldExamQuestion(
  exams: ReadonlyArray<{ name: string }>,
): string {
  const list = exams.map(({ name }) => `- ${name}`).join("\n");
  return exams.length === 1
    ? `This looks like an old exam. Is it one?\n${list}`
    : `These look like old exams. Which of them are?\n${list}`;
}
