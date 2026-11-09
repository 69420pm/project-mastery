import type { TutorContext } from "@/features/study";

const GOALS = {
  pass: "Pass",
  good_grade: "A good grade",
  master_everything: "Master everything",
} as const;

/** The goal as the Context sheet shows it. */
export function goalLabel(goal: TutorContext["goal"]): string {
  return goal === null ? "Not answered" : GOALS[goal];
}
