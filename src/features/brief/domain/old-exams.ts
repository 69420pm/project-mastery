/** Words in a Material's name that make it a likely old exam. */
const LIKELY_EXAM = /klausur|exam|prüfung|resit/i;

/**
 * Whether a Material's name marks it as a likely old exam, such as
 * "Altklausur 2023" or "Resit exam". The Student still confirms it.
 */
export function isLikelyExam(name: string): boolean {
  return LIKELY_EXAM.test(name);
}

/**
 * The static question the Brief posts about Materials parsed after intake:
 * "Are any of these old exams?" with their names, naming the likely ones.
 */
export function oldExamQuestion(materials: Array<{ name: string }>): string {
  const names = materials.map(({ name }) => name);
  const likely = names.filter(isLikelyExam);
  const question = `Are any of these old exams? ${names.join(", ")}`;
  if (likely.length === 0) return question;
  const hint =
    likely.length === 1
      ? `${likely[0]} looks like an old exam by its name.`
      : `${likely.join(", ")} look like old exams by their names.`;
  return `${question}\n\n${hint}`;
}
