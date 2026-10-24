import {
  PHASE_NAMES,
  recallText,
  type TutorContext,
  type TutorToday,
} from "@/features/study";

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

/**
 * The context's Today plan, which contexts stored before #177 lack.
 */
export function todayOf(context: TutorContext): TutorToday | null {
  return (context.todayPlan as TutorToday | undefined) ?? null;
}

/** The fit line, or "No pacing" without one. */
export function pacingText(context: TutorContext): string {
  return todayOf(context)?.fitLine ?? "No pacing";
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
