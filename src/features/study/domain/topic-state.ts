/**
 * A Topic's Topic state and today's recall (#176), from its KCs' replayed
 * recall. Pure, like the replay it reads.
 */
import { UNTAUGHT, type KcRecall } from "@/features/study/domain/replay";

/** Where a Student stands on a Topic. */
export type TopicStateName = "new" | "in_progress" | "learned" | "solid";

/** A Topic's state, and the mean of its KCs' recall today, 0 to 1. */
export type TopicState = { state: TopicStateName; recall: number };

/**
 * A Topic's state and recall from its KCs' recall: `solid` when every KC's
 * recall on the exam day reaches `retention`; `learned` when every KC is
 * taught; `in_progress` when some is; else `new`. `recall` counts an
 * untaught KC as 0. A Topic without KCs is new.
 */
export function topicState(
  kcIds: string[],
  recall: Map<string, KcRecall>,
  retention: number,
): TopicState {
  const kcs = kcIds.map((id) => recall.get(id) ?? UNTAUGHT);
  const taught = kcs.filter((kc) => kc.taught).length;
  const state: TopicStateName =
    taught === 0
      ? "new"
      : kcs.every((kc) => kc.taught && kc.recallOnExamDay >= retention)
        ? "solid"
        : taught === kcs.length
          ? "learned"
          : "in_progress";
  const sum = kcs.reduce((total, kc) => total + kc.recallToday, 0);
  return { state, recall: kcs.length === 0 ? 0 : sum / kcs.length };
}
