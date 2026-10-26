import type { ReviewFinding } from "@/features/knowledge-map";

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
  /** Whether the Student confirmed which Materials the exam covers. */
  scopeConfirmed: boolean;
};

/** The longest a Brief's notes may grow, in characters (the column's check). */
export const MAX_BRIEF_NOTES_LENGTH = 20_000;

/** A Course's Material as the AI sees it in the Brief. */
type BriefMaterial = { id: string; name: string; excluded: boolean };

/** An old exam among the Course's Materials, as the reservation lists it. */
export type ExamMaterial = {
  id: string;
  name: string;
  year: number | null;
  totalPoints: number | null;
};

/** The Student's answer to the reservation question. */
export type ReservedExam = {
  /** Whether the Student answered, with an exam or with none. */
  answered: boolean;
  /** The reserved exam Material; null for none. */
  materialId: string | null;
};

/** Everything the AI is told about a Brief before it replies. */
export type BriefContext = {
  fields: BriefFields;
  notes: string | null;
  materials: BriefMaterial[];
  /** The Course's old exams, oldest upload first. */
  exams: ExamMaterial[];
  reservedExam: ReservedExam;
  /** The Course's open Findings, in map order; none before intake is done. */
  findings: ReviewFinding[];
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
 * Whether the Brief asks the reservation question now: once intake is done,
 * while the Course has an old exam and the Student has not answered it.
 */
function asksReservation(
  fields: BriefFields | null,
  exams: ExamMaterial[],
  reserved: ReservedExam,
): boolean {
  return isIntakeDone(fields) && exams.length > 0 && !reserved.answered;
}

/**
 * Whether the Brief asks about the Findings: once intake is done and the
 * reservation question, when there is one, is answered.
 */
export function asksFindings(
  fields: BriefFields | null,
  exams: ExamMaterial[],
  reserved: ReservedExam,
): boolean {
  return isIntakeDone(fields) && !asksReservation(fields, exams, reserved);
}

/**
 * The exam the reservation question suggests: with two or more, the most
 * recent by year (a later upload breaks ties, an exam without a year comes
 * last); with only one, none, so that it stays for practice.
 */
export function suggestedReservation(
  exams: ExamMaterial[],
): ExamMaterial | null {
  if (exams.length < 2) return null;
  return exams.reduce((best, exam) =>
    (exam.year ?? -Infinity) >= (best.year ?? -Infinity) ? exam : best,
  );
}
