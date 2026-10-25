/**
 * Which Problems the generate workflow queues (#183). A KC's stock is its
 * unseen Problems: unseen Exercises, ready and unflagged generated Problems
 * not yet asked, and queued ones; failed ones don't count. A queued Problem
 * is a variant of an Exercise testing the KC that has no variant yet, seen
 * Exercises first, or else a new Problem for the KC, whose target
 * difficulty the caller sets.
 */

/** Unseen Problems a Topic's KC should have. */
export const TOPIC_STOCK_PER_KC = 2;

/** The most Problems one Topic stock run queues. */
export const TOPIC_STOCK_CAP = 4;

/** How many days ahead a review stock run looks for due KCs. */
export const REVIEW_DAYS_AHEAD = 3;

/** The most Problems one review stock run queues. */
export const REVIEW_STOCK_CAP = 6;

/** An Exercise as a variant source. */
export type StockExercise = {
  id: string;
  kcs: string[];
  /** Whether the Student has been asked it. */
  seen: boolean;
  /** Whether any generated Problem varies it already, whatever its status. */
  hasVariant: boolean;
};

/** What a stock run plans on. */
export type StockInput = {
  /** The Course's Exercises, in map order. */
  exercises: StockExercise[];
  /** The KCs of each unseen Problem of the Course. */
  unseen: Array<{ kcs: string[] }>;
};

/** A Problem to queue. */
export type PlannedProblem =
  | { source: "variant"; exerciseId: string; kcs: string[] }
  | { source: "new"; kcs: [string] };

/** A planner that counts what it plans as stock. */
function planner({ exercises, unseen }: StockInput) {
  const planned: PlannedProblem[] = [];
  const varied = new Set(
    exercises.filter((e) => e.hasVariant).map((e) => e.id),
  );
  const stock = (kcId: string) =>
    [...unseen, ...planned].filter(({ kcs }) => kcs.includes(kcId)).length;
  const queue = (kcId: string) => {
    const testing = exercises.filter(
      (e) => e.kcs.includes(kcId) && !varied.has(e.id),
    );
    const exercise = testing.find((e) => e.seen) ?? testing[0];
    if (exercise) {
      varied.add(exercise.id);
      planned.push({
        source: "variant",
        exerciseId: exercise.id,
        kcs: exercise.kcs,
      });
    } else {
      planned.push({ source: "new", kcs: [kcId] });
    }
  };
  return { planned, stock, queue };
}

/**
 * Topic stock: each of the Topic's KCs, in teaching order, with fewer than
 * 2 unseen Problems gets queued up to 2, at most 4 for the Topic.
 */
export function planTopicStock(
  kcIds: string[],
  input: StockInput,
): PlannedProblem[] {
  const { planned, stock, queue } = planner(input);
  for (const kcId of kcIds) {
    while (
      stock(kcId) < TOPIC_STOCK_PER_KC &&
      planned.length < TOPIC_STOCK_CAP
    ) {
      queue(kcId);
    }
  }
  return planned;
}

/**
 * Review stock: each KC due within 3 days, soonest first, with no unseen
 * Problem gets one queued, at most 6.
 */
export function planReviewStock(
  dueKcIds: string[],
  input: StockInput,
): PlannedProblem[] {
  const { planned, stock, queue } = planner(input);
  for (const kcId of dueKcIds) {
    if (planned.length >= REVIEW_STOCK_CAP) break;
    if (stock(kcId) === 0) queue(kcId);
  }
  return planned;
}

/**
 * The KCs whose next review is on or before `REVIEW_DAYS_AHEAD` days after
 * `today` (YYYY-MM-DD), soonest first; KCs without a next review are left
 * out.
 */
export function dueSoon(
  nextReviews: Array<{ kcId: string; nextReview: string | null }>,
  today: string,
): string[] {
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + REVIEW_DAYS_AHEAD);
  const until = last.toISOString().slice(0, 10);
  return nextReviews
    .filter(
      (kc): kc is { kcId: string; nextReview: string } =>
        kc.nextReview !== null && kc.nextReview <= until,
    )
    .toSorted((a, b) => a.nextReview.localeCompare(b.nextReview))
    .map(({ kcId }) => kcId);
}
