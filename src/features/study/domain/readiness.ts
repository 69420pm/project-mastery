/**
 * Readiness (#186): the share of the exam's weight a Student is likely to
 * recall on the day, from their KCs' replayed recall and Priorities. Pure.
 */
import { UNTAUGHT, type KcRecall } from "@/features/study/domain/replay";

/**
 * The Priority-weighted mean of the KCs' recall on the exam day, 0 to 1, an
 * untaught KC counting 0. A KC without a Priority weighs nothing; null when
 * no KC weighs anything.
 */
export function readiness(
  kcs: Array<{ id: string }>,
  priorities: Record<string, number>,
  recall: Map<string, KcRecall>,
): number | null {
  let weight = 0;
  let sum = 0;
  for (const kc of kcs) {
    const priority = priorities[kc.id] ?? 0;
    if (priority <= 0) continue;
    weight += priority;
    sum += priority * (recall.get(kc.id) ?? UNTAUGHT).recallOnExamDay;
  }
  return weight === 0 ? null : sum / weight;
}
