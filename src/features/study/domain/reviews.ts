/**
 * The due reviews the AI starts a session with (#103): the KCs whose next
 * review is today or earlier, most urgent first. Pure code; the tutor
 * context feeds it the stored map, the replayed ladder and the Priorities
 * on every reply.
 */
import {
  daysBetween,
  type LadderPosition,
} from "@/features/study/domain/ladder";

/** A due KC as the AI is told of it. */
type DueReview = {
  id: string;
  name: string;
  type: string;
  /** 1 to 5. */
  level: number;
  /** 0 when due today. */
  daysOverdue: number;
};

/** The most urgent due KCs, and how many more are due. */
export type DueReviews = { kcs: DueReview[]; more: number };

const MAX_DUE_REVIEWS = 8;

/**
 * The due KCs of `kcs` (in map order) on `today` (YYYY-MM-DD), ranked by
 * Priority × (days overdue + 1). A KC without a Priority counts as 0; ties
 * go to the longer overdue, then map order. `ladder` holds the taught KCs'
 * positions by id, `priorities` their Priorities.
 */
export function selectDueReviews(
  kcs: Array<{ id: string; name: string; type: string }>,
  ladder: ReadonlyMap<string, LadderPosition>,
  priorities: Record<string, number>,
  today: string,
): DueReviews {
  const due = kcs.flatMap((kc, position) => {
    const at = ladder.get(kc.id);
    if (!at || at.nextReview > today) return [];
    const daysOverdue = daysBetween(at.nextReview, today);
    const urgency = (priorities[kc.id] ?? 0) * (daysOverdue + 1);
    return [{ kc, position, level: at.level, daysOverdue, urgency }];
  });
  const ranked = due.toSorted(
    (a, b) =>
      b.urgency - a.urgency ||
      b.daysOverdue - a.daysOverdue ||
      a.position - b.position,
  );
  return {
    kcs: ranked.slice(0, MAX_DUE_REVIEWS).map(({ kc, level, daysOverdue }) => ({
      id: kc.id,
      name: kc.name,
      type: kc.type,
      level,
      daysOverdue,
    })),
    more: Math.max(0, ranked.length - MAX_DUE_REVIEWS),
  };
}
