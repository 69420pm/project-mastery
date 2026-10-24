/**
 * The due reviews the AI starts a session with (#103, #174): the KCs whose
 * card is due today or earlier, most urgent first. Pure code; the tutor
 * context feeds it the stored map, the replayed schedules and the
 * Priorities on every reply.
 */
import {
  isDue,
  retrievability,
  utcDay,
  type KcSchedule,
} from "@/features/study/domain/replay";

/** A due KC as the AI is told of it. */
type DueReview = {
  id: string;
  name: string;
  type: string;
  /** Today's FSRS recall, 0 to 1. */
  retrievability: number;
};

/** The most urgent due KCs, and how many more are due. */
export type DueReviews = { kcs: DueReview[]; more: number };

const MAX_DUE_REVIEWS = 8;

/**
 * The due KCs of `kcs` (in map order) at `now`, ranked by Priority × (1 −
 * today's recall). A KC without a Priority counts as 0; ties go to map
 * order. `schedules` holds the taught KCs' schedules by id, `priorities`
 * their Priorities.
 */
export function selectDueReviews(
  kcs: Array<{ id: string; name: string; type: string }>,
  schedules: ReadonlyMap<string, KcSchedule>,
  priorities: Record<string, number>,
  now: Date,
): DueReviews {
  const today = utcDay(now);
  const due = kcs.flatMap((kc, position) => {
    const card = schedules.get(kc.id)?.card;
    if (!card || !isDue(card, today)) return [];
    const recall = retrievability(card, now);
    const urgency = (priorities[kc.id] ?? 0) * (1 - recall);
    return [{ kc, position, recall, urgency }];
  });
  const ranked = due.toSorted(
    (a, b) => b.urgency - a.urgency || a.position - b.position,
  );
  return {
    kcs: ranked.slice(0, MAX_DUE_REVIEWS).map(({ kc, recall }) => ({
      id: kc.id,
      name: kc.name,
      type: kc.type,
      retrievability: recall,
    })),
    more: Math.max(0, ranked.length - MAX_DUE_REVIEWS),
  };
}
