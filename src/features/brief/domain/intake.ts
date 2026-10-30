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

/** A Course's Material as the AI sees it in the Brief. */
export type BriefMaterial = {
  id: string;
  name: string;
  excluded: boolean;
  /** Whether the Student said it is an old exam. */
  exam: boolean;
  /** Whether the Brief has asked if it is an old exam. */
  examAsked: boolean;
};

/** An old exam among the Course's Materials, as the reservation lists it. */
export type ExamMaterial = { id: string; name: string };

/** The Student's answer to the reservation question. */
export type ReservedExam = {
  /** Whether the Student answered, with an exam or with none. */
  answered: boolean;
  /** The reserved exam Material; null for none. */
  materialId: string | null;
};

/** A stored exam scope: one Big idea or Topic the exam leaves out or stresses. */
export type BriefExamScope = {
  bigIdeaId: string | null;
  topicId: string | null;
  scope: "excluded" | "emphasized";
  /** The Student's words. */
  words: string;
};

/** A Big idea of the Course with its Topics, as the AI sees them. */
export type BriefBigIdea = {
  id: string;
  name: string;
  topics: Array<{ id: string; name: string }>;
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
  /** The Course's old exams, oldest upload first. */
  exams: ExamMaterial[];
  reservedExam: ReservedExam;
  /** The Course's Big ideas and Topics, in Course order. */
  bigIdeas: BriefBigIdea[];
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
 * The exam the reservation question suggests: with two or more, the latest
 * upload; with only one, none, so that it stays for practice. `exams` are
 * oldest upload first.
 */
export function suggestedReservation(
  exams: ExamMaterial[],
): ExamMaterial | null {
  return exams.length < 2 ? null : (exams.at(-1) ?? null);
}
