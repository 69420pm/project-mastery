/**
 * Readiness (#186): the share of the exam's weight a Student is likely to
 * recall on the day, from their KCs' schedules and Priorities. Pure.
 */
import {
  projectedRecall,
  type KcSchedule,
} from "@/features/study/domain/replay";

/**
 * The Priority-weighted mean of the KCs' projected recall, 0 to 1. A KC with
 * a card counts its projected recall; an untaught one 0. A KC without a
 * Priority weighs nothing; null when no KC weighs anything.
 */
export function readiness(
  kcs: Array<{ id: string }>,
  priorities: Record<string, number>,
  schedules: Map<string, KcSchedule>,
  { now, examDate }: { now: Date; examDate: string | null },
): number | null {
  let weight = 0;
  let sum = 0;
  for (const kc of kcs) {
    const priority = priorities[kc.id] ?? 0;
    if (priority <= 0) continue;
    const card = schedules.get(kc.id)?.card;
    const recall = card ? projectedRecall(card, now, examDate) : 0;
    weight += priority;
    sum += priority * recall;
  }
  return weight === 0 ? null : sum / weight;
}
