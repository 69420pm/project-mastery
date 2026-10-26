/**
 * Readiness (#186): the share of the exam's weight a Student is likely to
 * recall on the day, from their KCs' schedules and Priorities. Pure.
 */
import {
  projectedRecall,
  type KcSchedule,
} from "@/features/study/domain/replay";

/** The recall a prior-knowledge KC without a card counts as. */
export const PRIOR_RECALL = 0.9;

/** A KC for the weighting: prior knowledge counts as `PRIOR_RECALL`. */
export type ReadinessKc = { id: string; prior: boolean };

/**
 * The Priority-weighted mean of the KCs' projected recall, 0 to 1. A KC with
 * a card counts its projected recall; without one, a prior-knowledge KC
 * counts 0.9 and an untaught KC 0. A KC without a Priority weighs nothing;
 * null when no KC weighs anything.
 */
export function readiness(
  kcs: ReadinessKc[],
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
    const recall = card
      ? projectedRecall(card, now, examDate)
      : kc.prior
        ? PRIOR_RECALL
        : 0;
    weight += priority;
    sum += priority * recall;
  }
  return weight === 0 ? null : sum / weight;
}
