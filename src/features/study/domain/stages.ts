/**
 * The stages of a learn session (#180): where it starts, and which moves
 * the tutor's `setStage` allows. Pure.
 */

/** A learn session's stages, in order. */
export const STAGES = [
  "review",
  "orient",
  "prime",
  "read",
  "work",
  "apply",
  "rebuild",
  "close",
] as const;

export type Stage = (typeof STAGES)[number];

/** Each stage as the stage bar names it. */
export const STAGE_NAMES: Record<Stage, string> = {
  review: "Review",
  orient: "Orient",
  prime: "Prime",
  read: "Read",
  work: "Work",
  apply: "Apply",
  rebuild: "Rebuild",
  close: "Close",
};

export function isStage(value: unknown): value is Stage {
  return (STAGES as readonly unknown[]).includes(value);
}

/**
 * Where a session on a Topic goes once its due reviews are done: the stage
 * the Topic's most recent earlier session stopped at, when it stopped before
 * `close` and past `review`, otherwise `orient`.
 */
export function resumeStage(previous: Stage | null): Stage {
  return previous === null || previous === "review" || previous === "close"
    ? "orient"
    : previous;
}

/**
 * The stage a session on a Topic starts at: `review` when reviews are due,
 * otherwise where it resumes (`resumeStage`).
 */
export function startStage(previous: Stage | null, reviewsDue: boolean): Stage {
  return reviewsDue ? "review" : resumeStage(previous);
}

/** A `setStage` call against where the session stands. */
type StageMove = {
  from: Stage;
  to: Stage;
  /** The tutor's one-line reason; empty or missing without one. */
  reason?: string | null | undefined;
  /** Where the session goes after `review` (`resumeStage`). */
  afterReview: Stage;
  /** Whether a Reading section of the Topic has no Done message yet. */
  readingLeft: boolean;
};

/**
 * Why `setStage` refuses a move, as the tutor reads it; null when it is
 * allowed. Without a reason it allows the next stage in order, `work` →
 * `read` while a Reading section is left, and `review` → `afterReview`. Any
 * other forward move needs a reason. Moving backwards otherwise, and leaving
 * `close`, are refused.
 */
export function stageMoveRefusal(move: StageMove): string | null {
  const { from, to } = move;
  if (from === to) return null;
  if (from === "close") {
    return "The session is at close: it stays there.";
  }
  const back = STAGES.indexOf(to) < STAGES.indexOf(from);
  const reread = from === "work" && to === "read" && move.readingLeft;
  if (back && !reread) {
    return from === "work" && to === "read"
      ? "Every Reading section of the Topic is done: there is nothing left to read."
      : `The session is at ${from}: it never moves back to ${to}.`;
  }
  if (reread) return null;
  const allowed = [STAGES[STAGES.indexOf(from) + 1]];
  if (from === "review") allowed.push(move.afterReview);
  if (allowed.includes(to) || move.reason?.trim()) return null;
  return `Moving from ${from} to ${to} skips a stage: give a one-line reason, or move to ${allowed.join(" or ")}.`;
}
