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
  /**
   * The id of the first Topic with the KC, to read it with `getTopic`. Null
   * without one; contexts stored before #180 have none.
   */
  topicId?: string | null;
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
 * their Priorities. Due KCs of `first`, such as the session Topic's anchors,
 * come before the rest, ranked the same way. `topicOf` gives each KC's Topic.
 */
export function selectDueReviews(
  kcs: Array<{ id: string; name: string; type: string }>,
  schedules: ReadonlyMap<string, KcSchedule>,
  priorities: Record<string, number>,
  now: Date,
  first: readonly string[] = [],
  topicOf: ReadonlyMap<string, string> = new Map(),
): DueReviews {
  const today = utcDay(now);
  const due = kcs.flatMap((kc, position) => {
    const card = schedules.get(kc.id)?.card;
    if (!card || !isDue(card, today)) return [];
    const recall = retrievability(card, now);
    const urgency = (priorities[kc.id] ?? 0) * (1 - recall);
    return [{ kc, position, recall, urgency }];
  });
  const firstRank = (id: string) => (first.includes(id) ? 0 : 1);
  const ranked = due.toSorted(
    (a, b) =>
      firstRank(a.kc.id) - firstRank(b.kc.id) ||
      b.urgency - a.urgency ||
      a.position - b.position,
  );
  return {
    kcs: ranked.slice(0, MAX_DUE_REVIEWS).map(({ kc, recall }) => ({
      id: kc.id,
      name: kc.name,
      type: kc.type,
      topicId: topicOf.get(kc.id) ?? null,
      retrievability: recall,
    })),
    more: Math.max(0, ranked.length - MAX_DUE_REVIEWS),
  };
}
