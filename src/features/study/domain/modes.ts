/**
 * The modes a Student starts a Study session in: learn, review and practice
 * from the Today card, results from a graded Mock exam's page.
 */
export const SESSION_MODES = [
  "learn",
  "review",
  "practice",
  "results",
] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export function isSessionMode(value: unknown): value is SessionMode {
  return SESSION_MODES.some((mode) => mode === value);
}

/** The mode a `?mode=` value names; learn for anything else. */
export function parseSessionMode(value: unknown): SessionMode {
  return isSessionMode(value) ? value : "learn";
}

export const MODE_LABELS: Record<SessionMode, string> = {
  learn: "Learn",
  review: "Review",
  practice: "Practice",
  results: "Results",
};
