/** A KC's FSRS schedule as the Chat shows it (#174). */

/** Today's recall, such as "Recall today 84%". */
export const recallText = (retrievability: number) =>
  `Recall today ${Math.round(retrievability * 100)}%`;

/**
 * A graded KC's recall and next review, such as "Recall today 84%, next
 * review 2026-10-27". Without a card, while its first session runs, the
 * first review comes once the session ends. Replies stored before FSRS
 * (#174) have a next review but no recall.
 */
export function scheduleText(kc: {
  retrievability?: number | null;
  nextReview?: string | null;
}): string {
  const { retrievability, nextReview } = kc;
  if (nextReview == null) return "first review set when the session ends";
  if (retrievability == null) return `next review ${nextReview}`;
  return `${recallText(retrievability)}, next review ${nextReview}`;
}
