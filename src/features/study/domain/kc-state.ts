/**
 * A KC's state as the map page and the Chat show it, read from its replayed
 * recall. Recall bands replace it (#250 slice 2).
 */
import type { KcRecall } from "@/features/study/domain/replay";

/** A KC's state. */
export type KcStateName = "new" | "learning" | "due" | "known";

/** A KC's state with its next review and today's recall. */
export type KcState = {
  state: KcStateName;
  /** As YYYY-MM-DD; null untaught. */
  nextReview: string | null;
  /** Today's FSRS recall, 0 to 1; null untaught. */
  retrievability: number | null;
};

/**
 * `new` untaught, `due` when its card is, `known` once learned, else
 * `learning`.
 */
export function kcState(recall: KcRecall | undefined): KcState {
  if (!recall?.taught) {
    return { state: "new", nextReview: null, retrievability: null };
  }
  return {
    state: recall.due ? "due" : recall.learned ? "known" : "learning",
    nextReview: recall.nextReview,
    retrievability: recall.recallToday,
  };
}
