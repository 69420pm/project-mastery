/** A graded KC's recall and next review as the Chat shows it. */

/** Today's recall, such as "Recall today 84%". */
export const recallText = (recall: number) =>
  `Recall today ${Math.round(recall * 100)}%`;

/**
 * A graded KC's band, recall and next review, such as "fading, Recall
 * today 84%, next review 2026-10-27".
 */
export function scheduleText(kc: {
  band: string;
  recallToday: number | null;
  nextReview: string | null;
}): string {
  return [
    kc.band,
    ...(kc.recallToday === null ? [] : [recallText(kc.recallToday)]),
    ...(kc.nextReview === null ? [] : [`next review ${kc.nextReview}`]),
  ].join(", ");
}
