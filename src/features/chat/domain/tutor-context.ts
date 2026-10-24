import { PHASE_NAMES, recallText, type TutorContext } from "@/features/study";

const GOALS = {
  pass: "Pass",
  good_grade: "A good grade",
  master_everything: "Master everything",
} as const;

/** The Phase as the Context sheet shows it. */
export function phaseLabel(phase: TutorContext["phase"]): string {
  return phase === null ? "None" : PHASE_NAMES[phase];
}

/** The goal as the Context sheet shows it. */
export function goalLabel(goal: TutorContext["goal"]): string {
  return goal === null ? "Not answered" : GOALS[goal];
}

/** The pacing share with the left-out count, such as "80% fit, 4 left out". */
export function pacingText({
  share,
  leftOutCount,
}: Pick<TutorContext, "share" | "leftOutCount">): string {
  if (share === null || leftOutCount === null) return "No pacing";
  return `${share}% fit, ${leftOutCount} left out`;
}

/**
 * A due review with today's recall, such as "due · Recall today 84%".
 * Contexts stored before FSRS (#174) have no recall.
 */
export function dueReviewText(kc: { retrievability?: number }): string {
  return kc.retrievability === undefined
    ? "due"
    : `due · ${recallText(kc.retrievability)}`;
}
