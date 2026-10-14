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
export type BriefMaterial = { id: string; name: string; excluded: boolean };

/** Everything the AI is told about a Brief before it replies. */
export type BriefContext = {
  fields: BriefFields;
  notes: string | null;
  materials: BriefMaterial[];
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
