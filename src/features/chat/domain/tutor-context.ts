import type { TutorContext } from "@/features/study";

const PHASES = {
  build: "Build",
  deepen: "Deepen",
  final_week: "Final week",
} as const;

const GOALS = {
  pass: "Pass",
  good_grade: "A good grade",
  master_everything: "Master everything",
} as const;

/** The Phase as the Context sheet shows it. */
export function phaseLabel(phase: TutorContext["phase"]): string {
  return phase === null ? "None" : PHASES[phase];
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

/** How overdue a review is, such as "due today" or "2 days overdue". */
export function overdueText(daysOverdue: number): string {
  if (daysOverdue === 0) return "due today";
  return `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`;
}
