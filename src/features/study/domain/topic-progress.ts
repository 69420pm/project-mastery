/**
 * A Topic's progress (#176): its Topic state and today's recall, from its
 * KCs' replayed schedules. Pure, like the replay it reads.
 */
import type { Card } from "ts-fsrs";
import {
  projectedRecall,
  retrievability,
  type KcSchedule,
} from "@/features/study/domain/replay";

/** Where a Student stands on a Topic. */
export type TopicStateName =
  "new" | "in_progress" | "learned" | "solid" | "needs_work";

/** A Topic's state, and the mean of its KCs' recall today, 0 to 1. */
export type TopicProgress = { state: TopicStateName; recall: number };

/** Lapses from which a KC's card makes its Topic need work. */
const NEEDS_WORK_LAPSES = 3;

type Options = { now: Date; examDate: string | null; retention: number };

/**
 * A Topic's progress from its KCs' schedules (a KC is taught when it has
 * one). `recall` counts a KC without a card as 0. A Topic without KCs is
 * new.
 */
export function topicProgress(
  kcIds: string[],
  schedules: Map<string, KcSchedule>,
  options: Options,
): TopicProgress {
  const cards = kcIds.flatMap((id) => {
    const card = schedules.get(id)?.card;
    return card ? [card] : [];
  });
  const recall =
    kcIds.length === 0
      ? 0
      : cards.reduce(
          (sum, card) => sum + retrievability(card, options.now),
          0,
        ) / kcIds.length;
  const taught = kcIds.filter((id) => schedules.has(id)).length;
  return {
    state: topicState(kcIds.length, taught, cards, options),
    recall,
  };
}

/**
 * The first that holds: `needs_work` when a card has 3 or more lapses;
 * `solid` when every KC has a card whose projected recall reaches the
 * retention; `learned` when every KC is taught; `in_progress` when some is;
 * else `new`.
 */
function topicState(
  kcs: number,
  taught: number,
  cards: Card[],
  { now, examDate, retention }: Options,
): TopicStateName {
  if (kcs === 0 || taught === 0) return "new";
  if (cards.some((card) => card.lapses >= NEEDS_WORK_LAPSES)) {
    return "needs_work";
  }
  if (
    cards.length === kcs &&
    cards.every((card) => projectedRecall(card, now, examDate) >= retention)
  ) {
    return "solid";
  }
  return taught === kcs ? "learned" : "in_progress";
}
