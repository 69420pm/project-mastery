import type { AttemptResult } from "@/features/study/domain/replay";

/**
 * The scoring rules of a graded Mock exam (#186): an item's points from its
 * graded steps, the numeric check's cap, and the mock's score and Brier
 * score over the items grading did not fail.
 */

/** One graded step of an item's answer. */
export type GradedStep = { points: number; reason: string };

/** How the item's final value compared with its key; null when unchecked. */
export type MockCheck = "match" | "mismatch" | null;

/** To the nearest half point. */
const toHalf = (points: number) => Math.round(points * 2) / 2;

/**
 * The points an item awards: its steps' sum in halves, from 0 to its
 * points; on a mismatched final value at most its points − 1.
 */
export function awardedPoints(
  steps: GradedStep[],
  points: number,
  check: MockCheck,
): number {
  const max = check === "mismatch" ? Math.max(0, points - 1) : points;
  const sum = steps.reduce((total, step) => total + step.points, 0);
  return Math.min(max, Math.max(0, toHalf(sum)));
}

/** A KC's result after the check: a mismatch turns `full` into `partial`. */
export const checkedResult = (
  result: AttemptResult,
  check: MockCheck,
): AttemptResult =>
  check === "mismatch" && result === "full" ? "partial" : result;

/** An item as the score reads it; `awarded` is null when grading failed. */
export type ScoredItem = {
  points: number;
  awarded: number | null;
  predictedSuccess: number;
};

/** A graded mock's item as its result page sums it. */
export type ResultItem = ScoredItem & { topic: string | null };

/**
 * The score and the prediction as percentages, and the points per Topic in
 * task order, all over the graded items.
 */
export function mockResultShares(items: ResultItem[]): {
  scorePercent: number;
  predictedPercent: number;
  topics: Array<{ name: string; awarded: number; points: number }>;
} {
  const graded = items.filter((item) => item.awarded !== null);
  const total = graded.reduce((sum, item) => sum + item.points, 0);
  const percent = (value: number) =>
    total === 0 ? 0 : Math.round((100 * value) / total);
  const topics = new Map<string, { awarded: number; points: number }>();
  for (const item of graded) {
    const name = item.topic ?? "Other";
    const topic = topics.get(name) ?? { awarded: 0, points: 0 };
    topic.awarded += item.awarded!;
    topic.points += item.points;
    topics.set(name, topic);
  }
  return {
    scorePercent: percent(mockScore(graded).score),
    predictedPercent: percent(
      graded.reduce(
        (sum, item) => sum + item.points * item.predictedSuccess,
        0,
      ),
    ),
    topics: [...topics].map(([name, sums]) => ({ name, ...sums })),
  };
}

/**
 * The mock's score, the points awarded, and its Brier score, the mean of
 * (predicted success − awarded / points)², both over the graded items; the
 * Brier score is null without one.
 */
export function mockScore(items: ScoredItem[]): {
  score: number;
  brier: number | null;
} {
  const graded = items.flatMap((item) =>
    item.awarded === null ? [] : [{ ...item, awarded: item.awarded }],
  );
  const score = graded.reduce((sum, item) => sum + item.awarded, 0);
  if (graded.length === 0) return { score, brier: null };
  const squared = graded.map(
    (item) => (item.predictedSuccess - item.awarded / item.points) ** 2,
  );
  return {
    score,
    brier: squared.reduce((sum, value) => sum + value, 0) / graded.length,
  };
}
