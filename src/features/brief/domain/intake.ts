/** The fixed fields of a Brief, each null until the Student has answered it. */
export type BriefFields = {
  /** The exam's date, as `YYYY-MM-DD`. */
  examDate: string | null;
  goal: "pass" | "good_grade" | "master_everything" | null;
  hoursPerWeek: number | null;
  questionStyle: "written" | "multiple_choice" | "mixed" | null;
  openBook: boolean | null;
  formulaSheet: boolean | null;
  calculator: boolean | null;
  /**
   * Whether the Student answered the scope step: the excluded Materials, the
   * old exams and the exam scope.
   */
  scopeConfirmed: boolean;
};

/** The longest a Brief's notes may grow, in characters (the column's check). */
export const MAX_BRIEF_NOTES_LENGTH = 20_000;

/** A Chapter of a Material's Outline, as the AI sees it in the Brief. */
export type BriefChapter = {
  id: string;
  title: string;
  /** 0 for the root Chapter, which is titled by the Material's name. */
  depth: number;
  /** Whether the parse took it for an old exam (`proposedExam`). */
  proposed: boolean;
  /** The Student's answer: an old exam or not; null before they answered. */
  exam: boolean | null;
  /** Whether the Brief has asked if it is an old exam. */
  examAsked: boolean;
};

/** A Course's Material as the AI sees it in the Brief. */
export type BriefMaterial = {
  id: string;
  name: string;
  excluded: boolean;
  /**
   * Its Chapters in reading order, to depth 2, and any deeper one that is
   * proposed or answered as an old exam.
   */
  chapters: BriefChapter[];
};

/**
 * An old exam of the Course: a confirmed Chapter not inside another, named
 * "<Material> › <Chapter>", or the Material's name for its root.
 */
export type ExamChapter = { id: string; name: string };

/** The Student's answer to the reservation question. */
export type ReservedExam = {
  /** Whether the Student answered, with an exam or with none. */
  answered: boolean;
  /** The reserved old-exam Chapter; null for none. */
  chapterId: string | null;
};

/** The Course language that the build writes the Knowledge map in. */
export type CourseLanguage = {
  /** An English name, such as German. */
  name: string;
  /** Whether the Student asked for it, rather than the Materials' own. */
  chosen: boolean;
};

/**
 * A stored exam scope: one Topic the exam leaves out or stresses, with its
 * subtree unless a Topic below has its own.
 */
export type BriefExamScope = {
  topicId: string;
  scope: "excluded" | "emphasized";
  /** The Student's words. */
  words: string;
};

/** A Topic of the Course's Topic tree, as the AI sees it. */
export type BriefTopic = {
  id: string;
  name: string;
  /** 0 at the top. */
  depth: number;
};

/** An admin text of the Materials, with where it first appears. */
export type AdminText = {
  text: string;
  /** "<Material> p. N". */
  source: string;
};

/** Everything the AI is told about a Brief before it replies. */
export type BriefContext = {
  fields: BriefFields;
  notes: string | null;
  /** The Course's Materials, oldest upload first. */
  materials: BriefMaterial[];
  /** The Course's old exams in Course order: Materials oldest first. */
  exams: ExamChapter[];
  reservedExam: ReservedExam;
  language: CourseLanguage;
  /** The Course's Topic tree in tree order: a parent before its children. */
  topics: BriefTopic[];
  examScopes: BriefExamScope[];
  /** The distinct admin texts of the Materials, in Course order. */
  adminTexts: AdminText[];
};

/**
 * Whether the Student has finished telling the AI about the exam: every fixed
 * field is answered and the scope is confirmed. The notes are free text and
 * never required.
 */
export function isIntakeDone(fields: BriefFields | null): boolean {
  if (!fields) return false;
  const { scopeConfirmed, ...answers } = fields;
  return scopeConfirmed && Object.values(answers).every((v) => v !== null);
}

/**
 * The exam the reservation question suggests: with two or more, the last
 * in Course order; with only one, none, so that it stays for practice.
 */
export function suggestedReservation(exams: ExamChapter[]): ExamChapter | null {
  return exams.length < 2 ? null : (exams.at(-1) ?? null);
}
