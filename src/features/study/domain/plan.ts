/**
 * The plan scope of a Course over its Topics (#250): which Topics the goal
 * and the Student's pins and skips put in the plan, and the Progress over
 * them. Pure code on UTC days, like the FSRS replay; nothing about it is
 * stored.
 */
import {
  daysBetween,
  type Goal,
  type KcRecall,
  utcDay,
} from "@/features/study/domain/replay";

/** The share of the total Topic priority the goal *to pass* takes. */
const PASS_SHARE = 0.8;

/** How long the Student takes per KC taught and per review, in minutes. */
export type Pace = { minutesPerKc: number; minutesPerReview: number };

/** The pace before any is measured. */
export const DEFAULT_PACE: Pace = { minutesPerKc: 30, minutesPerReview: 2 };

/** A Student's choice on a Topic, which overrides the goal. */
export type TopicChoice = {
  topicId: string;
  choice: "pinned" | "skipped";
  /** An ISO timestamp; earlier pins come first. */
  createdAt: string;
};

/** Whether the plan holds a Topic. */
export type TopicPlanStatus = "in_plan" | "if_time_allows" | "skipped";

/** A Topic's place in the plan scope. */
export type TopicScope = {
  id: string;
  status: TopicPlanStatus;
  /** When the Student pinned it, as an ISO timestamp; null unpinned. */
  pinnedAt: string | null;
};

/** A stored Topic as the plan reads it: its KC ids in teaching order. */
export type PlanTopic = { id: string; kcs: string[] };

/**
 * The plan scope of a Course's Topics, in Course order. The goal picks the
 * Topics in the plan (`goalTopics`); a pin always adds one and a skip always
 * removes one. The rest are "if time allows".
 */
export function planScope(input: {
  /** In Course order. */
  topics: PlanTopic[];
  /** Priority by KC id; a missing one counts as 0. */
  priorities: Record<string, number>;
  goal: Goal;
  choices: TopicChoice[];
}): TopicScope[] {
  const choice = new Map(input.choices.map((c) => [c.topicId, c]));
  const goalSet = goalTopics(
    input.topics.map((t) => ({
      id: t.id,
      priority: t.kcs.reduce((sum, id) => sum + (input.priorities[id] ?? 0), 0),
    })),
    input.goal,
  );
  return input.topics.map((topic) => {
    const chosen = choice.get(topic.id);
    const pinned = chosen?.choice === "pinned";
    return {
      id: topic.id,
      status:
        chosen?.choice === "skipped"
          ? "skipped"
          : pinned || goalSet.has(topic.id)
            ? "in_plan"
            : "if_time_allows",
      pinnedAt: pinned ? chosen.createdAt : null,
    };
  });
}

/**
 * The Topics the goal puts in the plan, by id. *To pass* takes Topics by
 * priority, highest first and ties in Course order, until their sum reaches
 * 80% of the total, the Topic crossing it included. *A good grade* and no
 * goal take every Topic with priority above 0; *to master everything* every
 * Topic.
 */
export function goalTopics(
  topics: Array<{ id: string; priority: number }>,
  goal: Goal,
): Set<string> {
  if (goal === "master_everything") return new Set(topics.map((t) => t.id));
  if (goal !== "pass") {
    return new Set(topics.filter((t) => t.priority > 0).map((t) => t.id));
  }
  const total = topics.reduce((sum, t) => sum + t.priority, 0);
  const taken = new Set<string>();
  let sum = 0;
  for (const topic of topics.toSorted((a, b) => b.priority - a.priority)) {
    if (sum >= PASS_SHARE * total) break;
    taken.add(topic.id);
    sum += topic.priority;
  }
  return taken;
}

/** A Topic's badges in the plan, which the map and its Topic page show. */
export function topicBadges(topic: TopicScope): string[] {
  return [
    ...(topic.pinnedAt !== null ? ["pinned"] : []),
    ...(topic.status === "skipped" ? ["skipped"] : []),
    ...(topic.status === "if_time_allows" ? ["if time allows"] : []),
  ];
}

/**
 * How far the Student has come: the in-plan KCs (`total`) and how many of
 * them are learned (`learned`), the UTC days since the first Attempt with
 * that day counting as 1 (`daysIn`), and the days to the exam (`daysLeft`,
 * 0 on its day). It falls only when the plan or the map changes.
 */
export type Progress = {
  learned: number;
  total: number;
  /** Null without Attempts. */
  daysIn: number | null;
  /** Null without an exam date or once it has passed. */
  daysLeft: number | null;
};

/**
 * The Progress over the in-plan Topics' KCs. A KC counts once it is
 * learned: it has a `full` Attempt without help.
 */
export function planProgress(input: {
  topics: PlanTopic[];
  scope: TopicScope[];
  recall: Map<string, KcRecall>;
  examDate: string | null;
  /** The Course's first Attempt, as an ISO timestamp; null without one. */
  firstAttemptAt: string | null;
  now: Date;
}): Progress {
  const { recall, examDate, firstAttemptAt, now } = input;
  const inPlan = new Set(
    input.scope.filter((t) => t.status === "in_plan").map((t) => t.id),
  );
  const kcs = input.topics.flatMap((t) => (inPlan.has(t.id) ? t.kcs : []));
  const today = utcDay(now);
  const daysLeft = examDate === null ? null : daysBetween(today, examDate);
  return {
    learned: kcs.filter((id) => recall.get(id)?.learned).length,
    total: kcs.length,
    daysIn:
      firstAttemptAt === null
        ? null
        : daysBetween(utcDay(firstAttemptAt), today) + 1,
    daysLeft: daysLeft !== null && daysLeft >= 0 ? daysLeft : null,
  };
}
