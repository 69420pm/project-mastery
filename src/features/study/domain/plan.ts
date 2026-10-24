/**
 * The study plan of a Course, derived on every read (#106): its Phase before
 * the exam and whether the Student's weekly hours cover the KCs that matter
 * before the final week. Pure code on UTC days, like the FSRS replay; nothing
 * about it is stored.
 */
import { daysBetween } from "@/features/study/domain/replay";

/** Where a Course's study stands before its exam. */
export type Phase = "build" | "deepen" | "final_week";

/** Each Phase's name wherever the app shows it. */
export const PHASE_NAMES = {
  build: "Build",
  deepen: "Deepen",
  final_week: "Final week",
} as const satisfies Record<Phase, string>;

/**
 * The days before the exam that are only Review: the final week is the exam
 * day plus these 7 days before it.
 */
const FINAL_WEEK_DAYS = 7;

/** The fixed time a KC takes, covering its teaching and later Reviews. */
const MINUTES_PER_KC = 30;

/** Whether the weekly hours until the final week cover the relevant KCs. */
type Pacing = {
  /** (taught + fitting) / relevant, as a whole percent rounded down. */
  share: number;
  /** The untaught relevant KCs that won't fit, lowest Priority last. */
  leftOut: string[];
};

export type Plan = {
  /** Null without an exam date or once it has passed. */
  phase: Phase | null;
  /** Null without a Phase or weekly hours, and in the final week. */
  pacing: Pacing | null;
};

export type PlanInput = {
  /** The map's KCs; prior knowledge has no big idea. */
  kcs: Array<{ id: string; name: string; bigIdea: string | null }>;
  /** Priority by KC id; a KC without one counts as relevant, ranked last. */
  priorities: Record<string, number>;
  /** The ids of KCs with an Attempt. */
  taught: ReadonlySet<string>;
  exam: { examDate: string | null; hoursPerWeek: number | null };
  /** As YYYY-MM-DD. */
  today: string;
};

/**
 * The plan from the relevant KCs (Priority above 0, not prior knowledge):
 * the final week on the exam day and the 7 days before it, deepen once every
 * relevant KC is taught, build otherwise, including when no KC is relevant
 * yet (an unbuilt map), since deepen steers away from new KCs. Pacing fits
 * the untaught relevant KCs, highest Priority first and ties by name, into
 * the hours until the final week.
 */
export function planStudy({
  kcs,
  priorities,
  taught,
  exam,
  today,
}: PlanInput): Plan {
  if (exam.examDate === null) return { phase: null, pacing: null };
  const daysLeft = daysBetween(today, exam.examDate);
  if (daysLeft < 0) return { phase: null, pacing: null };

  const relevant = kcs.filter(
    (kc) =>
      kc.bigIdea !== null &&
      (priorities[kc.id] === undefined || priorities[kc.id]! > 0),
  );
  const untaught = relevant.filter((kc) => !taught.has(kc.id));
  const phase: Phase =
    daysLeft <= FINAL_WEEK_DAYS
      ? "final_week"
      : relevant.length > 0 && untaught.length === 0
        ? "deepen"
        : "build";
  if (phase === "final_week" || exam.hoursPerWeek === null) {
    return { phase, pacing: null };
  }

  const hours = (exam.hoursPerWeek * (daysLeft - FINAL_WEEK_DAYS)) / 7;
  const capacity = Math.floor((hours * 60) / MINUTES_PER_KC);
  const ranked = untaught.toSorted(
    (a, b) =>
      (priorities[b.id] ?? -1) - (priorities[a.id] ?? -1) ||
      a.name.localeCompare(b.name),
  );
  const fitting = Math.min(capacity, ranked.length);
  const covered = relevant.length - untaught.length + fitting;
  return {
    phase,
    pacing: {
      share:
        relevant.length === 0
          ? 100
          : Math.floor((covered * 100) / relevant.length),
      leftOut: ranked.slice(fitting).map((kc) => kc.id),
    },
  };
}
