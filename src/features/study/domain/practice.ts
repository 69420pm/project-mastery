/**
 * A practice session's KCs (#184): the taught KCs of the learned Topics to
 * pose Problems on, most urgent first. Pure code, rebuilt on every reply.
 */
import {
  retrievability,
  type KcSchedule,
} from "@/features/study/domain/replay";
import type { TopicPlanStatus } from "@/features/study/domain/plan";
import type { TopicStateName } from "@/features/study/domain/topic-state";

/** The most KCs a practice session is given. */
const MAX_PRACTICE_KCS = 8;

/** The Topic states a practice session works on. */
const PRACTICE_STATES: readonly TopicStateName[] = [
  "learned",
  "solid",
  "needs_work",
];

/** A KC of a practice session as the AI is told of it. */
export type PracticeKc = {
  id: string;
  name: string;
  type: string;
  /** The first practised Topic with the KC. */
  topicId: string;
};

/**
 * The taught KCs (with a schedule in `schedules`) of the in-plan Topics that
 * are learned, solid or need work, ranked by Priority × (1 − recall at
 * `now`), ties in map order (`kcs`), the top 8. A KC without a Priority
 * counts as 0, one without a card yet as fully recalled.
 */
export function selectPracticeKcs({
  kcs,
  topics,
  schedules,
  priorities,
  now,
}: {
  kcs: Array<{ id: string; name: string; type: string }>;
  topics: Array<{
    id: string;
    kcs: string[];
    status: TopicPlanStatus;
    state: TopicStateName;
  }>;
  schedules: ReadonlyMap<string, KcSchedule>;
  priorities: Record<string, number>;
  now: Date;
}): PracticeKc[] {
  const topicOf = new Map<string, string>();
  for (const topic of topics) {
    if (topic.status !== "in_plan" || !PRACTICE_STATES.includes(topic.state))
      continue;
    for (const id of topic.kcs) {
      if (!topicOf.has(id)) topicOf.set(id, topic.id);
    }
  }
  return kcs
    .flatMap((kc, position) => {
      const topicId = topicOf.get(kc.id);
      const schedule = schedules.get(kc.id);
      if (topicId === undefined || schedule === undefined) return [];
      const recall = schedule.card ? retrievability(schedule.card, now) : 1;
      const urgency = (priorities[kc.id] ?? 0) * (1 - recall);
      return [{ kc, topicId, position, urgency }];
    })
    .toSorted((a, b) => b.urgency - a.urgency || a.position - b.position)
    .slice(0, MAX_PRACTICE_KCS)
    .map(({ kc: { id, name, type }, topicId }) => ({
      id,
      name,
      type,
      topicId,
    }));
}
