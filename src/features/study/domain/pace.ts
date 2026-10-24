/**
 * Measured pace (#177): how long the Student takes per KC taught and per
 * review, read from their sessions' messages and their questions. Pure; the
 * active time is computed on every read, not stored.
 */
import { DEFAULT_PACE, type Pace } from "@/features/study/domain/plan";
import {
  schedulingAttempts,
  type ReplayAttempt,
} from "@/features/study/domain/replay";

/** The longest gap between messages that counts as active, in seconds. */
const GAP_CAP_SECONDS = 5 * 60;

/** The longest time to answer a review that counts, in seconds. */
const REVIEW_CAP_SECONDS = 5 * 60;

/** Ended teaching sessions needed before minutes per KC is measured. */
const MIN_TEACHING_SESSIONS = 3;

/** The newest teaching sessions minutes per KC is the median of. */
const TEACHING_SAMPLE = 5;

/** Review attempts needed before minutes per review is measured. */
const MIN_REVIEWS = 5;

/** What the active time reads of a Chat message. */
export type PaceMessage = {
  role: "user" | "assistant";
  /** An ISO timestamp. */
  createdAt: string;
};

/** An ended session that first taught KCs, with its reviews. */
export type TeachingSession = {
  sessionId: string;
  /** How many KCs it taught first. */
  kcsTaught: number;
  /** How many of its attempts were reviews. */
  reviews: number;
  /** Its first scheduling attempt, as an ISO timestamp, for its order. */
  firstAt: string;
};

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * A session's active seconds: the gaps between the Student's consecutive
 * messages plus the gap from their last one to the AI's last reply, each
 * capped at 5 minutes.
 */
export function activeSeconds(messages: PaceMessage[]): number {
  const sorted = messages.toSorted(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const times = sorted
    .filter((message) => message.role === "user")
    .map((message) => Date.parse(message.createdAt));
  const lastReply = sorted.findLast((message) => message.role === "assistant");
  if (lastReply && times.length > 0) {
    const replyAt = Date.parse(lastReply.createdAt);
    if (replyAt > times.at(-1)!) times.push(replyAt);
  }
  let total = 0;
  for (let i = 1; i < times.length; i++) {
    total += Math.min(GAP_CAP_SECONDS, (times[i]! - times[i - 1]!) / 1000);
  }
  return total;
}

/**
 * The Course's review attempts, the replay's scheduling first attempt in a
 * later session, and its ended sessions that first taught a KC, oldest
 * first. A KC whose first session still runs has neither.
 */
export function paceEvidence(
  attempts: ReplayAttempt[],
  ended: (sessionId: string) => boolean,
): { reviews: ReplayAttempt[]; teaching: TeachingSession[] } {
  const reviews: ReplayAttempt[] = [];
  const taught = new Map<string, { kcs: number; firstAt: string }>();
  for (const kcAttempts of Map.groupBy(attempts, (a) => a.kcId).values()) {
    const split = schedulingAttempts(kcAttempts);
    if (split === null || !ended(split.firstId)) continue;
    reviews.push(...split.reviews);
    const firstAt = split.first[0]!.createdAt;
    const session = taught.get(split.firstId);
    taught.set(split.firstId, {
      kcs: (session?.kcs ?? 0) + 1,
      firstAt:
        session && Date.parse(session.firstAt) < Date.parse(firstAt)
          ? session.firstAt
          : firstAt,
    });
  }
  const reviewsIn = Map.groupBy(reviews, (attempt) => attempt.sessionId);
  const teaching = [...taught]
    .map(([sessionId, { kcs, firstAt }]) => ({
      sessionId,
      kcsTaught: kcs,
      reviews: reviewsIn.get(sessionId)?.length ?? 0,
      firstAt,
    }))
    .toSorted((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  return { reviews, teaching };
}

/**
 * The Student's pace. Minutes per review is the median time to answer a
 * review, capped at 5 minutes, once 5 reviews are answered. Minutes per KC
 * is the median over the newest 5 teaching sessions with a known active time
 * of (active minutes − its reviews × minutes per review) ÷ KCs taught first,
 * at least 1, once there are 3 such sessions. Until then each is the
 * default.
 */
export function measurePace({
  reviews,
  teaching,
  active,
}: {
  reviews: ReplayAttempt[];
  teaching: TeachingSession[];
  /** A teaching session's active seconds; undefined when unknown. */
  active: (sessionId: string) => number | undefined;
}): Pace {
  const answered = reviews.flatMap((attempt) =>
    attempt.seconds === null
      ? []
      : [Math.min(REVIEW_CAP_SECONDS, attempt.seconds)],
  );
  const minutesPerReview =
    answered.length >= MIN_REVIEWS
      ? median(answered) / 60
      : DEFAULT_PACE.minutesPerReview;
  const perKc = teaching.flatMap((session) => {
    const seconds = active(session.sessionId);
    if (seconds === undefined) return [];
    const teachingMinutes = seconds / 60 - session.reviews * minutesPerReview;
    return [teachingMinutes / session.kcsTaught];
  });
  const minutesPerKc =
    perKc.length >= MIN_TEACHING_SESSIONS
      ? Math.max(1, median(perKc.slice(-TEACHING_SAMPLE)))
      : DEFAULT_PACE.minutesPerKc;
  return { minutesPerKc, minutesPerReview };
}
