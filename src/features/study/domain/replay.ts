/**
 * FSRS replay (#174, ADR "FSRS replay"): each KC's card, replayed with
 * `ts-fsrs` from its attempts on every read. Pure code on UTC days, like the
 * Daily limit; nothing derived is stored, so a changed exam date or goal
 * applies on the next read.
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

/** `pre` for prequestions, which never schedule; `learn` otherwise. */
export type AttemptKind = "pre" | "learn";

/** The Brief's goal, which sets the desired retention. */
export type Goal = "pass" | "good_grade" | "master_everything" | null;

/** What the replay reads of an attempt. */
export type ReplayAttempt = {
  kcId: string;
  sessionId: string;
  /** An ISO timestamp. */
  createdAt: string;
  kind: AttemptKind;
  result: AttemptResult;
  help: AttemptHelp;
  /** The question the attempt grades, for the median seconds. */
  questionId: string;
  /** The Student's confidence from 1 to 4; null when not given. */
  confidence: number | null;
  /** Seconds from asking to answering the question; null if unanswered. */
  seconds: number | null;
};

/** The Student's median seconds to answer, by attempt kind. */
export type MedianSeconds = Partial<Record<AttemptKind, number>>;

/**
 * A taught KC's schedule: its FSRS card, null while the first session with
 * a non-`pre` attempt on it is still open.
 */
export type KcSchedule = { card: Card | null };

/** A KC's state, as the map page and the Chat show it. */
export type KcStateName = "new" | "learning" | "due" | "known";

/** A KC's state with its next review and today's recall. */
export type KcState = {
  state: KcStateName;
  /** As YYYY-MM-DD; null without a card. */
  nextReview: string | null;
  /** Today's FSRS recall, 0 to 1; null without a card. */
  retrievability: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a session may sit without a message before it counts as ended. */
const IDLE_MS = 2 * 60 * 60 * 1000;

/** Stability under which a not-due card is still `learning`, in days. */
const LEARNING_STABILITY = 7;

/** The UTC day of an ISO timestamp, as YYYY-MM-DD. */
export const utcDay = (timestamp: string | Date) =>
  new Date(timestamp).toISOString().slice(0, 10);

/** The days from one YYYY-MM-DD day to another, negative when earlier. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** The day `days` after a YYYY-MM-DD day, before it when negative. */
export const addDays = (day: string, days: number) =>
  utcDay(new Date(Date.parse(day) + days * DAY_MS));

/**
 * When a session ended, as an ISO timestamp, or null while it runs: its
 * `ended_at`, or else its Chat's newest message once that is more than 2
 * hours before `now`.
 */
export function sessionEnd(
  session: { endedAt: string | null; newestMessageAt: string | null },
  now: Date,
): string | null {
  if (session.endedAt !== null) return session.endedAt;
  const newest = session.newestMessageAt;
  if (newest !== null && now.getTime() - Date.parse(newest) > IDLE_MS) {
    return newest;
  }
  return null;
}

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
 * The median seconds to answer per attempt kind over the answered questions
 * with attempts of that kind; a kind without any is missing.
 */
export function medianSeconds(attempts: ReplayAttempt[]): MedianSeconds {
  const byQuestion = new Map<string, ReplayAttempt>();
  for (const a of attempts) {
    if (a.seconds !== null) byQuestion.set(`${a.kind}:${a.questionId}`, a);
  }
  const medians: MedianSeconds = {};
  for (const [kind, group] of Map.groupBy(byQuestion.values(), (a) => a.kind)) {
    const sorted = group.map((a) => a.seconds!).toSorted((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medians[kind] =
      sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return medians;
}

/**
 * An attempt's FSRS rating: wrong or with the solution shown is Again,
 * partial or with some help is Hard, full without help is Good. Full without
 * help with confidence 4 and seconds to answer strictly below the median for
 * its kind is Easy.
 */
export function rateAttempt(
  attempt: {
    result: AttemptResult;
    help: AttemptHelp;
    kind?: AttemptKind;
    confidence?: number | null;
    seconds?: number | null;
  },
  medians: MedianSeconds = {},
): Grade {
  if (attempt.result === "wrong" || attempt.help === "solution_shown") {
    return Rating.Again;
  }
  if (attempt.result === "partial" || attempt.help === "some") {
    return Rating.Hard;
  }
  const median = medians[attempt.kind ?? "learn"];
  if (
    attempt.confidence === 4 &&
    attempt.seconds != null &&
    median !== undefined &&
    attempt.seconds < median
  ) {
    return Rating.Easy;
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
 * Reviews `card` with `attempt`'s rating at its time. With an exam after
 * the review's day, the due date is at most half the days left (rounded
 * down, at least 1) after it.
 */
function review(
  f: FSRS,
  card: Card,
  attempt: ReplayAttempt,
  examDate: string | null,
  medians: MedianSeconds,
): Card {
  const reviewed = f.next(
    card,
    attempt.createdAt,
    rateAttempt(attempt, medians),
  ).card;
  const day = utcDay(attempt.createdAt);
  if (examDate === null || examDate <= day) return reviewed;
  const cap = Math.max(1, Math.floor(daysBetween(day, examDate) / 2));
  const latest = new Date(Date.parse(attempt.createdAt) + cap * DAY_MS);
  if (reviewed.due <= latest) return reviewed;
  return { ...reviewed, due: latest, scheduled_days: cap };
}

/**
 * Replays one KC's attempts into its schedule; null without a non-`pre`
 * attempt. The first session with one creates the card once it has ended,
 * rated by its last attempt there and dated at it. In every later session,
 * only the first attempt is a review; the rest don't schedule.
 */
export function replayKc(
  attempts: ReplayAttempt[],
  {
    ended,
    examDate,
    retention,
    medians = {},
  }: {
    ended: (sessionId: string) => boolean;
    examDate: string | null;
    retention: number;
    medians?: MedianSeconds;
  },
): KcSchedule | null {
  const scheduling = attempts
    .filter((attempt) => attempt.kind !== "pre")
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const sessions = [...Map.groupBy(scheduling, (attempt) => attempt.sessionId)];
  if (sessions.length === 0) return null;
  const [[firstId, first], ...later] = sessions as [
    [string, ReplayAttempt[]],
    ...Array<[string, ReplayAttempt[]]>,
  ];
  if (!ended(firstId)) return { card: null };
  const f = scheduler(retention);
  const created = first.at(-1)!;
  let card = review(
    f,
    createEmptyCard(created.createdAt),
    created,
    examDate,
    medians,
  );
  for (const [, inSession] of later) {
    const attempt = inSession[0]!;
    // A session that ran alongside the first one can predate its card.
    if (Date.parse(attempt.createdAt) < card.last_review!.getTime()) continue;
    card = review(f, card, attempt, examDate, medians);
  }
  return { card };
}

/**
 * Replays the Course's attempts into each taught KC's schedule by KC id,
 * then applies the final-week sweep (`finalWeekSweep`).
 */
export function replayCourse(
  attempts: ReplayAttempt[],
  {
    ended,
    examDate,
    goal,
    priorities,
    today,
  }: {
    ended: (sessionId: string) => boolean;
    examDate: string | null;
    goal: Goal;
    priorities: Record<string, number>;
    /** As YYYY-MM-DD. */
    today: string;
  },
): Map<string, KcSchedule> {
  const retention = desiredRetention(goal);
  const medians = medianSeconds(attempts);
  const schedules = new Map<string, KcSchedule>();
  for (const [kcId, kcAttempts] of Map.groupBy(attempts, (a) => a.kcId)) {
    const schedule = replayKc(kcAttempts, {
      ended,
      examDate,
      retention,
      medians,
    });
    if (schedule) schedules.set(kcId, schedule);
  }
  return finalWeekSweep(schedules, { examDate, priorities, today });
}

/**
 * The final-week sweep: with an exam date on `today` or later, the top half
 * (rounded up) of the KCs with a card by Priority (none counts as 0, ties
 * in `schedules` order) whose last review is more than 7 days before 3 days
 * ahead of the exam become due then at the latest.
 */
export function finalWeekSweep(
  schedules: Map<string, KcSchedule>,
  {
    examDate,
    priorities,
    today,
  }: {
    examDate: string | null;
    priorities: Record<string, number>;
    /** As YYYY-MM-DD. */
    today: string;
  },
): Map<string, KcSchedule> {
  if (examDate === null || examDate < today) return schedules;
  const cards = [...schedules].flatMap(([kcId, { card }]) =>
    card ? [{ kcId, card }] : [],
  );
  const top = cards
    .toSorted((a, b) => (priorities[b.kcId] ?? 0) - (priorities[a.kcId] ?? 0))
    .slice(0, Math.ceil(cards.length / 2));
  const sweepDay = addDays(examDate, -3);
  const swept = new Map(schedules);
  for (const { kcId, card } of top) {
    if (daysBetween(utcDay(card.last_review!), sweepDay) <= 7) continue;
    if (utcDay(card.due) <= sweepDay) continue;
    swept.set(kcId, { card: { ...card, due: new Date(sweepDay) } });
  }
  return swept;
}

/** The most reviews a forecast counts, a guard against a stuck card. */
const MAX_FORECAST_REVIEWS = 1000;

/**
 * The reviews a card gets before the day `until` (YYYY-MM-DD) if every one
 * is Good, through the replay's scheduler and exam cap: from its due date,
 * or `now` when it is overdue. Without `card`, a fresh card taught with
 * Good at `now`, whose teaching is not a review.
 */
export function forecastReviews(
  card: Card | null,
  {
    now,
    until,
    examDate,
    retention,
  }: { now: Date; until: string; examDate: string | null; retention: number },
): number {
  const f = scheduler(retention);
  const good = (at: Date): ReplayAttempt => ({
    kcId: "",
    sessionId: "",
    createdAt: at.toISOString(),
    kind: "learn",
    result: "full",
    help: "none",
    questionId: "",
    confidence: null,
    seconds: null,
  });
  let current =
    card ?? review(f, createEmptyCard(now), good(now), examDate, {});
  let reviews = 0;
  while (reviews < MAX_FORECAST_REVIEWS) {
    const at = new Date(Math.max(current.due.getTime(), now.getTime()));
    if (utcDay(at) >= until) break;
    current = review(f, current, good(at), examDate, {});
    reviews++;
  }
  return reviews;
}

/** Whether a card is due on `today` (YYYY-MM-DD): its due day or later. */
export const isDue = (card: Card, today: string) => utcDay(card.due) <= today;

/** A card's FSRS recall at `now`, from 0 to 1. */
export const retrievability = (card: Card, now: Date) =>
  scheduler(desiredRetention(null)).get_retrievability(card, now, false);

/**
 * A card's projected recall: its recall on the exam date (YYYY-MM-DD) while
 * the exam is still ahead of `now`'s day, otherwise today's.
 */
export function projectedRecall(
  card: Card,
  now: Date,
  examDate: string | null,
): number {
  return examDate !== null && examDate > utcDay(now)
    ? retrievability(card, new Date(examDate))
    : retrievability(card, now);
}

/**
 * A KC's state at `now` from its schedule (undefined for a KC without
 * non-`pre` attempts): `new` without one, `due` when its card is, `learning`
 * while its first session runs or its stability is under 7 days, else
 * `known`.
 */
export function kcState(schedule: KcSchedule | undefined, now: Date): KcState {
  if (!schedule) {
    return { state: "new", nextReview: null, retrievability: null };
  }
  const { card } = schedule;
  if (card === null) {
    return { state: "learning", nextReview: null, retrievability: null };
  }
  const today = utcDay(now);
  return {
    state: isDue(card, today)
      ? "due"
      : card.stability < LEARNING_STABILITY
        ? "learning"
        : "known",
    nextReview: utcDay(card.due),
    retrievability: retrievability(card, now),
  };
}
