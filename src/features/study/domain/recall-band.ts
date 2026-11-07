/**
 * A KC's recall band (#250), what the Student sees of a KC instead of its
 * card: from its recall at the end of the current UTC day, so a KC just
 * answered wrong is not `strong`. Pure.
 */
import type { KcRecall } from "@/features/study/domain/replay";

/** A KC's recall band. */
export type RecallBand = "new" | "strong" | "fading" | "weak";

/** Each band's name wherever the app shows it. */
export const BAND_NAMES: Record<RecallBand, string> = {
  new: "New",
  strong: "Strong",
  fading: "Fading",
  weak: "Weak",
};

/** Below this recall a taught KC is `weak`. */
const FADING_RECALL = 0.7;

/** A KC's band with its recall today and next review. */
export type KcBand = {
  band: RecallBand;
  /** 0 to 1; null untaught. */
  recallToday: number | null;
  /** As YYYY-MM-DD; null untaught. */
  nextReview: string | null;
};

/**
 * `new` untaught, `strong` at or above the goal's `retention`, `fading` at
 * 0.7 or more, else `weak`.
 */
export function recallBand(
  recall: KcRecall | undefined,
  retention: number,
): RecallBand {
  if (!recall?.taught) return "new";
  if (recall.recallToday >= retention) return "strong";
  return recall.recallToday >= FADING_RECALL ? "fading" : "weak";
}

/** A KC's band, recall today and next review (`recallBand`). */
export function kcBand(
  recall: KcRecall | undefined,
  retention: number,
): KcBand {
  return {
    band: recallBand(recall, retention),
    recallToday: recall?.taught ? recall.recallToday : null,
    nextReview: recall?.nextReview ?? null,
  };
}
