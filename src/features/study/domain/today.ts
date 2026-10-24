/**
 * The Today card (#177): what the Student does next in a Course, from its
 * study plan. Pure, like the plan it reads.
 */
import type { Pace, Plan, TopicPlan } from "@/features/study/domain/plan";
import {
  projectedRecall,
  type KcSchedule,
} from "@/features/study/domain/replay";

/** The Topic the Student works on next. */
export type TodayTopic = {
  id: string;
  name: string;
  centralQuestion: string;
  /** Its KC ids in teaching order. */
  kcs: string[];
};

export type TodayPlan = {
  /** The due reviews and their minutes at the Student's pace; null when none are due. */
  reviews: { count: number; minutes: number } | null;
  /** Null when the plan has no Topic to work on. */
  next: TodayTopic | null;
  /** What kind of work the Phase calls for; null in build and without one. */
  hint: string | null;
};

const HINTS = {
  deepen: "Practice exam-style problems",
  final_week: "Try an old exam under exam conditions",
} as const;

/**
 * Today's work from a plan: the due reviews, then the next Topic. In build
 * and without an exam date it is the first of the plan order. In Deepen it
 * is an in-plan Topic that needs work, otherwise a learned one, otherwise a
 * solid one, each the one with the lowest recall. In the final week it is
 * the taught, unskipped Topic with the highest priority × (1 − its KCs' mean
 * recall projected to the exam), a KC without a card counting as 0: no new
 * Topics. Ties go to Course order.
 */
export function planToday(
  plan: Plan & { pace: Pace },
  input: {
    /** The stored Topics, with their KC ids in teaching order. */
    topics: Array<{ id: string; centralQuestion: string; kcs: string[] }>;
    schedules: Map<string, KcSchedule>;
    dueCount: number;
    examDate: string | null;
    now: Date;
  },
): TodayPlan {
  const next = nextTopic(plan, input);
  const stored = new Map(input.topics.map((t) => [t.id, t]));
  const topic = next && stored.get(next.id);
  return {
    reviews:
      input.dueCount === 0
        ? null
        : {
            count: input.dueCount,
            minutes: input.dueCount * plan.pace.minutesPerReview,
          },
    next: topic
      ? {
          id: topic.id,
          name: next.name,
          centralQuestion: topic.centralQuestion,
          kcs: topic.kcs,
        }
      : null,
    hint:
      plan.phase === "deepen" || plan.phase === "final_week"
        ? HINTS[plan.phase]
        : null,
  };
}

function nextTopic(
  plan: Plan,
  {
    topics,
    schedules,
    examDate,
    now,
  }: Pick<
    Parameters<typeof planToday>[1],
    "topics" | "schedules" | "examDate" | "now"
  >,
): TopicPlan | null {
  const byId = new Map(plan.topics.map((t) => [t.id, t]));
  if (plan.phase === null || plan.phase === "build") {
    return plan.order[0] === undefined ? null : byId.get(plan.order[0])!;
  }
  if (plan.phase === "deepen") {
    const inPlan = plan.topics.filter((t) => t.status === "in_plan");
    for (const state of ["needs_work", "learned", "solid"] as const) {
      const lowest = best(
        inPlan.filter((t) => t.topicState.state === state),
        (t) => -t.topicState.recall,
      );
      if (lowest) return lowest;
    }
    return null;
  }
  const kcsOf = new Map(topics.map((t) => [t.id, t.kcs]));
  const meanProjected = (topic: TopicPlan) => {
    const kcs = kcsOf.get(topic.id) ?? [];
    const sum = kcs.reduce((total, id) => {
      const card = schedules.get(id)?.card;
      return total + (card ? projectedRecall(card, now, examDate) : 0);
    }, 0);
    return kcs.length === 0 ? 0 : sum / kcs.length;
  };
  return best(
    plan.topics.filter(
      (t) => t.status !== "skipped" && t.topicState.state !== "new",
    ),
    (t) => t.priority * (1 - meanProjected(t)),
  );
}

/** The item with the highest score, the first on a tie; null when none. */
function best<T>(items: T[], score: (item: T) => number): T | null {
  let top: T | null = null;
  let topScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > topScore) {
      top = item;
      topScore = value;
    }
  }
  return top;
}
