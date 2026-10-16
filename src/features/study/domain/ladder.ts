/**
 * The review ladder (#103): where a KC stands, replayed from its attempts.
 * Pure code on UTC days, like the Daily limit; nothing about it is stored,
 * so a changed exam date applies on the next read.
 */

/** How much the AI helped on an attempt. */
export type AttemptHelp = "none" | "some" | "solution_shown";

/** What the replay reads of an attempt. */
export type LadderAttempt = {
  /** An ISO timestamp. */
  createdAt: string;
  correct: boolean;
  help: AttemptHelp;
};

export type AttemptOutcome = "correct" | "with_help" | "wrong";

/** A taught KC's place on the ladder. */
export type LadderPosition = {
  /** 1 to 5. */
  level: number;
  /** As YYYY-MM-DD. */
  nextReview: string;
};

/** The interval of each level in days: level 1 is index 0. */
export const LEVEL_INTERVALS = [1, 3, 7, 14, 30] as const;

export const TOP_LEVEL = LEVEL_INTERVALS.length;

export function attemptOutcome(attempt: {
  correct: boolean;
  help: AttemptHelp;
}): AttemptOutcome {
  if (!attempt.correct || attempt.help === "solution_shown") return "wrong";
  return attempt.help === "none" ? "correct" : "with_help";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day of an ISO timestamp, as YYYY-MM-DD. */
export const utcDay = (timestamp: string | Date) =>
  new Date(timestamp).toISOString().slice(0, 10);

const addDays = (day: string, days: number) =>
  utcDay(new Date(Date.parse(day) + days * DAY_MS));

/** The days from one YYYY-MM-DD day to another, negative when earlier. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/**
 * A level's interval from `day`: with an exam after `day`, at most a quarter
 * of the days left (rounded down), and at least 1 day.
 */
function interval(level: number, day: string, examDate: string | null) {
  const days = LEVEL_INTERVALS[level - 1]!;
  if (examDate === null || examDate <= day) return days;
  return Math.max(
    1,
    Math.min(days, Math.floor(daysBetween(day, examDate) / 4)),
  );
}

/**
 * Replays a KC's attempts in time order; null when it has none. The first
 * makes it taught at level 1, due the next day. From then on, on or after
 * the due day a correct attempt climbs a level (at most 5), one with help
 * keeps it, and a wrong one drops it to level 1, due the next day. Before
 * the due day only a wrong attempt counts.
 */
export function replayLadder(
  attempts: LadderAttempt[],
  examDate: string | null,
): LadderPosition | null {
  const ordered = attempts.toSorted(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  let position: LadderPosition | null = null;
  for (const attempt of ordered) {
    const day = utcDay(attempt.createdAt);
    const outcome = attemptOutcome(attempt);
    let level: number;
    if (position === null || outcome === "wrong") level = 1;
    else if (day < position.nextReview) continue;
    else if (outcome === "correct")
      level = Math.min(TOP_LEVEL, position.level + 1);
    else level = position.level;
    position = {
      level,
      nextReview: addDays(day, interval(level, day, examDate)),
    };
  }
  return position;
}

/** A KC's state, as the map page and the Chat show it. */
export type KcStateName = "new" | "learning" | "due" | "mastered";

/** A KC's state on `today` (YYYY-MM-DD), from its place on the ladder. */
export function kcState(
  position: LadderPosition | null,
  today: string,
): KcStateName {
  if (position === null) return "new";
  if (position.nextReview <= today) return "due";
  return position.level >= 2 ? "mastered" : "learning";
}
