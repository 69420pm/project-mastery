/**
 * FSRS replay under the per-day rule (ADR "Per-day scheduling and one
 * ranking"): each KC's card, replayed with `ts-fsrs` from its Attempts on
 * every read, on UTC days. Nothing derived is stored, so a changed exam date
 * or goal applies on the next read.
 */
import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type FSRS,
  type Grade,
} from "ts-fsrs";

/** How much the AI helped on an attempt. */
export type AttemptHelp = "none" | "some" | "solution_shown";

/** How the AI graded the Student's answer on a KC. */
export type AttemptResult = "full" | "partial" | "wrong";

/** Where an Attempt was made; read only for analytics, never to schedule. */
export type AttemptSource = "chat" | "mock";

/** The Brief's goal, which sets the desired retention. */
export type Goal = "pass" | "good_grade" | "master_everything" | null;

/** What the replay and pace read of an Attempt. */
export type ReplayAttempt = {
  kcId: string;
  sessionId: string;
  /** An ISO timestamp. */
  createdAt: string;
  result: AttemptResult;
  help: AttemptHelp;
  /** Seconds from asking to answering its question; null if unanswered. */
  seconds: number | null;
};

/** What the replay gives of a KC. */
export type KcRecall = {
  /** It has a card: it has an Attempt. */
  taught: boolean;
  /** It has at least one `full` Attempt without help. */
  learned: boolean;
  /** FSRS recall at the end of today's UTC day, 0 to 1; 0 untaught. */
  recallToday: number;
  /** FSRS recall on the exam day; `recallToday` without an exam ahead. */
  recallOnExamDay: number;
  /** Its card's due day is today or earlier. */
  due: boolean;
  /** Its card's due day, as YYYY-MM-DD; null untaught. */
  nextReview: string | null;
};

/** A KC without Attempts. */
export const UNTAUGHT: KcRecall = {
  taught: false,
  learned: false,
  recallToday: 0,
  recallOnExamDay: 0,
  due: false,
  nextReview: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day of an ISO timestamp, as YYYY-MM-DD. */
export const utcDay = (timestamp: string | Date) =>
  new Date(timestamp).toISOString().slice(0, 10);

/** The days from one YYYY-MM-DD day to another, negative when earlier. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** The day `days` after a YYYY-MM-DD day, before it when negative. */
export const addDays = (day: string, days: number) =>
  utcDay(new Date(Date.parse(day) + days * DAY_MS));

/** The desired retention for the Brief's goal. */
export function desiredRetention(goal: Goal): number {
  switch (goal) {
    case "pass":
      return 0.85;
    case "master_everything":
      return 0.93;
    default:
      return 0.9;
  }
}

/**
 * An Attempt's FSRS rating: wrong or with the solution shown is Again,
 * partial or with some help is Hard, full without help is Good. There is no
 * Easy.
 */
export function rateAttempt(attempt: {
  result: AttemptResult;
  help: AttemptHelp;
}): Grade {
  if (attempt.result === "wrong" || attempt.help === "solution_shown") {
    return Rating.Again;
  }
  if (attempt.result === "partial" || attempt.help === "some") {
    return Rating.Hard;
  }
  return Rating.Good;
}

const schedulers = new Map<number, FSRS>();

/** FSRS-6 defaults, whole-day intervals and no fuzz (docs/agents/notes). */
function scheduler(retention: number): FSRS {
  let f = schedulers.get(retention);
  if (!f) {
    f = fsrs({
      request_retention: retention,
      enable_short_term: false,
      enable_fuzz: false,
    });
    schedulers.set(retention, f);
  }
  return f;
}

/**
 * One KC's Attempts by the per-day rule; null without any. `first` holds
 * the Attempts of its first UTC day, which teaches it; `reviews` the first
 * Attempt of each later UTC day, oldest first. Its other Attempts don't
 * schedule.
 */
export function kcDays(attempts: ReplayAttempt[]): {
  first: ReplayAttempt[];
  reviews: ReplayAttempt[];
} | null {
  const sorted = attempts.toSorted(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const days = [...Map.groupBy(sorted, (a) => utcDay(a.createdAt)).values()];
  const [first, ...later] = days;
  if (!first) return null;
  return { first, reviews: later.map((day) => day[0]!) };
}

/**
 * Replays one KC's Attempts into its card; null without any. Its first UTC
 * day's newest Attempt so far creates the card, dated at it; the first
 * Attempt of each later day reviews it.
 */
export function replayCard(
  attempts: ReplayAttempt[],
  retention: number,
): Card | null {
  const days = kcDays(attempts);
  if (days === null) return null;
  const f = scheduler(retention);
  const review = (card: Card, attempt: ReplayAttempt) =>
    f.next(card, attempt.createdAt, rateAttempt(attempt)).card;
  const created = days.first.at(-1)!;
  return days.reviews.reduce(
    review,
    review(createEmptyCard(created.createdAt), created),
  );
}

/**
 * A card's FSRS-6 recall at `at`, from 0 to 1, on the time since its last
 * review in fractional days. `ts-fsrs` counts only whole 24-hour periods,
 * which gives 1 all through the day of a review (docs/agents/notes).
 */
export function retrievability(card: Card, at: Date): number {
  const w = scheduler(desiredRetention(null)).parameters.w;
  const decay = -w[20]!;
  const factor = 0.9 ** (1 / decay) - 1;
  const last = card.last_review ?? card.due;
  const days = Math.max(0, (at.getTime() - last.getTime()) / DAY_MS);
  return (1 + (factor * days) / card.stability) ** decay;
}

/**
 * Replays the Course's Attempts into each taught KC's recall at `now`, by
 * KC id. KCs without an Attempt are missing (`UNTAUGHT`).
 */
export function replayCourse(
  attempts: ReplayAttempt[],
  { examDate, goal, now }: { examDate: string | null; goal: Goal; now: Date },
): Map<string, KcRecall> {
  const retention = desiredRetention(goal);
  const today = utcDay(now);
  const endOfToday = new Date(Date.parse(addDays(today, 1)) - 1);
  const recall = new Map<string, KcRecall>();
  for (const [kcId, kcAttempts] of Map.groupBy(attempts, (a) => a.kcId)) {
    const card = replayCard(kcAttempts, retention);
    if (card === null) continue;
    const recallToday = retrievability(card, endOfToday);
    recall.set(kcId, {
      taught: true,
      learned: kcAttempts.some((a) => a.result === "full" && a.help === "none"),
      recallToday,
      recallOnExamDay:
        examDate !== null && examDate > today
          ? retrievability(card, new Date(examDate))
          : recallToday,
      due: utcDay(card.due) <= today,
      nextReview: utcDay(card.due),
    });
  }
  return recall;
}
