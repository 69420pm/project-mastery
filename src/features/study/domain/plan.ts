/**
 * The study plan of a Course over its Topics (#177), derived on every read:
 * which Topics the goal puts in it, its Phase before the exam, the order of
 * the untaught work and what fits the weekly hours with the FSRS review
 * load. Pure code on UTC days, like the FSRS replay; nothing about it is
 * stored.
 */
import {
  addDays,
  daysBetween,
  desiredRetention,
  forecastReviews,
  type Goal,
  type KcSchedule,
  utcDay,
} from "@/features/study/domain/replay";
import {
  type TopicState,
  topicState,
} from "@/features/study/domain/topic-state";

/** Where a Course's study stands before its exam. */
export type Phase = "build" | "deepen" | "final_week";

/** Each Phase's name wherever the app shows it. */
export const PHASE_NAMES = {
  build: "Build",
  deepen: "Deepen",
  final_week: "Final week",
} as const satisfies Record<Phase, string>;

/**
 * The days before the exam that are only Review: the final week is the exam
 * day plus these 7 days before it.
 */
const FINAL_WEEK_DAYS = 7;

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

/** A Topic as the plan sees it. */
export type TopicPlan = {
  id: string;
  name: string;
  /** The sum of its KCs' Priorities, a missing one counting as 0. */
  priority: number;
  topicState: TopicState;
  status: TopicPlanStatus;
  pinned: boolean;
  /** Its KCs without a schedule, in teaching order. */
  untaught: string[];
  /**
   * For in-plan untaught work with a fit: whether it fits before the final
   * week. Null otherwise.
   */
  fits: boolean | null;
};

/** What fits the weekly hours before the final week. */
export type Fit = {
  /** In-plan Topics already taught or fitting. */
  fitting: number;
  inPlan: number;
  /**
   * The priority of taught and fitting Topics over all Topics', as a whole
   * percent rounded down; null when no Topic has priority.
   */
  examWeight: number | null;
};

export type Plan = {
  /** Null without an exam date or once it has passed. */
  phase: Phase | null;
  /** In Course order. */
  topics: TopicPlan[];
  /** The in-plan Topics with untaught work (new or in progress), by id. */
  order: string[];
  /** Null without a Phase or weekly hours, and in the final week. */
  fit: Fit | null;
};

export type PlanInput = {
  /** In Course order (`position`), with KC ids in teaching order. */
  topics: Array<{ id: string; name: string; kcs: string[] }>;
  prerequisites: Array<{ from: string; to: string }>;
  /** Priority by KC id. */
  priorities: Record<string, number>;
  /** The replayed schedule of each taught KC, by KC id. */
  schedules: Map<string, KcSchedule>;
  exam: {
    examDate: string | null;
    hoursPerWeek: number | null;
    goal: Goal;
  };
  choices: TopicChoice[];
  pace: Pace;
  now: Date;
};

/**
 * The plan of a Course's Topics. The goal picks the Topics in the plan
 * (`goalTopics`); a pin always adds one and a skip always removes one.
 * The Phase is the final week on the exam day and the 7 days before it,
 * deepen once every in-plan Topic is learned, solid or needs work, build
 * otherwise. The untaught work is ordered by `orderTopics` and fitted, in
 * that order, into the weekly hours left after the existing cards' reviews.
 */
export function planStudy(input: PlanInput): Plan {
  const { topics, priorities, schedules, exam, choices, pace, now } = input;
  const retention = desiredRetention(exam.goal);
  const choice = new Map(choices.map((c) => [c.topicId, c]));
  const priorityOf = (kcs: string[]) =>
    kcs.reduce((sum, id) => sum + (priorities[id] ?? 0), 0);
  const rated = topics.some((t) => t.kcs.some((id) => id in priorities));
  const goalSet = goalTopics(
    topics.map((t) => ({ id: t.id, priority: priorityOf(t.kcs) })),
    rated ? exam.goal : "master_everything",
  );

  const planned: TopicPlan[] = topics.map((topic) => {
    const chosen = choice.get(topic.id)?.choice;
    return {
      id: topic.id,
      name: topic.name,
      priority: priorityOf(topic.kcs),
      topicState: topicState(topic.kcs, schedules, {
        now,
        examDate: exam.examDate,
        retention,
      }),
      status:
        chosen === "skipped"
          ? "skipped"
          : chosen === "pinned" || goalSet.has(topic.id)
            ? "in_plan"
            : "if_time_allows",
      pinned: chosen === "pinned",
      untaught: topic.kcs.filter((id) => !schedules.has(id)),
      fits: null,
    };
  });
  const inPlan = planned.filter((t) => t.status === "in_plan");
  const order = orderTopics(
    inPlan.filter((t) => isUntaught(t)),
    topics,
    input.prerequisites,
    choices,
    pace,
  );

  const today = utcDay(now);
  const daysLeft =
    exam.examDate === null ? -1 : daysBetween(today, exam.examDate);
  if (exam.examDate === null || daysLeft < 0) {
    return { phase: null, topics: planned, order, fit: null };
  }
  const phase: Phase =
    daysLeft <= FINAL_WEEK_DAYS
      ? "final_week"
      : inPlan.length > 0 && inPlan.every((t) => !isUntaught(t))
        ? "deepen"
        : "build";
  if (phase === "final_week" || exam.hoursPerWeek === null) {
    return { phase, topics: planned, order, fit: null };
  }

  // Reviews before the final week, which starts on `until`.
  const forecast = {
    now,
    until: addDays(exam.examDate, -FINAL_WEEK_DAYS),
    examDate: exam.examDate,
    retention,
  };
  const existingReviews = [...schedules.values()].reduce(
    (sum, { card }) => sum + forecastReviews(card, forecast),
    0,
  );
  const freshReviews = forecastReviews(null, forecast);
  let budget =
    (exam.hoursPerWeek * (daysLeft - FINAL_WEEK_DAYS) * 60) / 7 -
    existingReviews * pace.minutesPerReview;
  const byId = new Map(planned.map((t) => [t.id, t]));
  let fitsSoFar = true;
  for (const id of order) {
    const topic = byId.get(id)!;
    const cost =
      topic.untaught.length *
      (pace.minutesPerKc + freshReviews * pace.minutesPerReview);
    fitsSoFar &&= cost <= budget;
    if (fitsSoFar) budget -= cost;
    topic.fits = fitsSoFar;
  }

  const covered = planned.filter((t) => !isUntaught(t) || t.fits === true);
  const total = planned.reduce((sum, t) => sum + t.priority, 0);
  const weight = covered.reduce((sum, t) => sum + t.priority, 0);
  return {
    phase,
    topics: planned,
    order,
    fit: {
      fitting: covered.filter((t) => t.status === "in_plan").length,
      inPlan: inPlan.length,
      examWeight: total > 0 ? Math.floor((weight * 100) / total) : null,
    },
  };
}

/** A Phase as a heading: "Build phase", "Deepen phase" or "Final week". */
export const phaseHeading = (phase: Phase) =>
  phase === "final_week" ? PHASE_NAMES[phase] : `${PHASE_NAMES[phase]} phase`;

/**
 * The fit line, such as "Build phase. At your pace, 9 of 12 Topics fit,
 * covering 84% of exam weight."; without exam weight it ends after "fit".
 */
export function fitText(phase: Phase, fit: Fit): string {
  const topics = fit.inPlan === 1 ? "Topic" : "Topics";
  const weight =
    fit.examWeight === null
      ? ""
      : `, covering ${fit.examWeight}% of exam weight`;
  return `${phaseHeading(phase)}. At your pace, ${fit.fitting} of ${fit.inPlan} ${topics} fit${weight}.`;
}

/** A Topic's badges in the plan, which the map and its Topic page show. */
export function topicBadges(topic: TopicPlan): string[] {
  return [
    ...(topic.pinned ? ["pinned"] : []),
    ...(topic.status === "skipped" ? ["skipped"] : []),
    ...(topic.fits === false ? ["won't fit"] : []),
    ...(topic.status === "if_time_allows" ? ["if time allows"] : []),
  ];
}

/** Whether a Topic still has untaught work: it is new or in progress. */
const isUntaught = (topic: TopicPlan) =>
  topic.topicState.state === "new" || topic.topicState.state === "in_progress";

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

/**
 * The untaught in-plan Topics in plan order: pinned first (earliest pin
 * first), then in progress, then by priority per estimated minute of
 * teaching, ties in Course order. A Topic never comes before one of these
 * that reaches it over the Topic arrows (a KC of one is a Prerequisite of a
 * KC of the other), unless both are on a cycle.
 */
function orderTopics(
  untaught: TopicPlan[],
  topics: PlanInput["topics"],
  prerequisites: PlanInput["prerequisites"],
  choices: TopicChoice[],
  pace: Pace,
): string[] {
  const position = new Map(topics.map((t, index) => [t.id, index]));
  const pinnedAt = new Map(
    choices
      .filter((c) => c.choice === "pinned")
      .map((c) => [c.topicId, Date.parse(c.createdAt)]),
  );
  const perMinute = (t: TopicPlan) =>
    t.priority / Math.max(1, t.untaught.length * pace.minutesPerKc);
  const group = (t: TopicPlan) =>
    t.pinned ? 0 : t.topicState.state === "in_progress" ? 1 : 2;
  const ranked = untaught.toSorted(
    (a, b) =>
      group(a) - group(b) ||
      (pinnedAt.get(a.id) ?? 0) - (pinnedAt.get(b.id) ?? 0) ||
      perMinute(b) - perMinute(a) ||
      position.get(a.id)! - position.get(b.id)!,
  );

  const reach = topicReach(topics, prerequisites);
  const before = (a: string, b: string) =>
    reach.get(a)!.has(b) && !reach.get(b)!.has(a);
  const order: string[] = [];
  const left = ranked.map((t) => t.id);
  while (left.length > 0) {
    const next = left.findIndex((id) => !left.some((o) => before(o, id)));
    order.push(...left.splice(next, 1));
  }
  return order;
}

/** The Topics each Topic reaches over one or more Topic arrows, by id. */
function topicReach(
  topics: PlanInput["topics"],
  prerequisites: PlanInput["prerequisites"],
): Map<string, Set<string>> {
  const topicOf = new Map(
    topics.flatMap((t) => t.kcs.map((kc) => [kc, t.id] as const)),
  );
  const next = new Map(topics.map((t) => [t.id, new Set<string>()]));
  for (const { from, to } of prerequisites) {
    const source = topicOf.get(from);
    const target = topicOf.get(to);
    if (source && target && source !== target) next.get(source)!.add(target);
  }
  return new Map(
    topics.map((t) => {
      const seen = new Set<string>();
      const stack = [...next.get(t.id)!];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...next.get(id)!);
      }
      return [t.id, seen];
    }),
  );
}
