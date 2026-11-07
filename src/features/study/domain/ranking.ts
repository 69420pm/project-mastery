/**
 * The ranking (#250): one ordered list of what is worth doing next in a
 * Course, read on every request from the map, Priority, the replayed cards,
 * the pace and the plan scope. Pure, on UTC days.
 */
import type { Pace, PlanTopic, TopicScope } from "@/features/study/domain/plan";
import {
  daysBetween,
  type KcRecall,
  utcDay,
} from "@/features/study/domain/replay";

/**
 * The final stretch is the exam day and this many days before it, when
 * everything in scope ranks together.
 */
export const FINAL_STRETCH_DAYS = 7;

/** Whether `now` falls in the final stretch before `examDate`. */
export function inFinalStretch(examDate: string | null, now: Date): boolean {
  if (examDate === null) return false;
  const days = daysBetween(utcDay(now), examDate);
  return days >= 0 && days <= FINAL_STRETCH_DAYS;
}

/**
 * A candidate of the ranking: a due KC (a Review), a Topic with untaught
 * KCs, or a taught KC that is not due (a refresh). `value` is Priority ×
 * (1 − recall), summed over a Topic's untaught KCs; `minutes` comes from
 * the pace.
 */
export type RankedItem =
  | {
      kind: "review" | "refresh";
      kcId: string;
      topicId: string;
      value: number;
      minutes: number;
    }
  | {
      kind: "topic";
      topicId: string;
      /** Its untaught KCs in teaching order. */
      untaught: string[];
      value: number;
      minutes: number;
    };

type Ranked = {
  item: RankedItem;
  /** Normally: due Reviews, in-plan Topics, refreshes, then the rest. */
  group: number;
  /** Course order: the Topic's place, then the KC's within it. */
  at: [number, number];
  started: boolean;
  pinnedAt: number;
};

/**
 * What is worth doing next, best first. Only Topics in the plan or "if time
 * allows" are in scope. Candidates of value 0 are dropped, except due
 * Reviews; ties go in Course order.
 *
 * Normally: due Reviews by value; then in-plan Topics, a started one first,
 * then pinned ones (earliest pin first), then by value per minute; then
 * refreshes by value, once no in-plan Topic has untaught KCs; then "if time
 * allows" Topics, ordered like the in-plan ones. In the final stretch
 * everything ranks together by value per minute. Either way a Topic never
 * comes before an untaught Topic in scope that it builds on.
 */
export function rankNext(input: {
  /** In Course order, with KC ids in teaching order. */
  topics: PlanTopic[];
  prerequisites: Array<{ from: string; to: string }>;
  /** Priority by KC id; a missing one counts as 0. */
  priorities: Record<string, number>;
  /** The replayed recall of each taught KC. */
  recall: Map<string, KcRecall>;
  pace: Pace;
  scope: TopicScope[];
  examDate: string | null;
  now: Date;
}): RankedItem[] {
  const { topics, priorities, recall, pace } = input;
  const scope = new Map(input.scope.map((s) => [s.id, s]));
  const priority = (kcId: string) => priorities[kcId] ?? 0;
  const candidates: Ranked[] = [];

  topics.forEach((topic, place) => {
    const topicScope = scope.get(topic.id);
    if (!topicScope || topicScope.status === "skipped") return;
    const inPlan = topicScope.status === "in_plan";
    const pinnedAt =
      topicScope.pinnedAt === null ? Infinity : Date.parse(topicScope.pinnedAt);
    const untaught: string[] = [];
    topic.kcs.forEach((kcId, index) => {
      const kc = recall.get(kcId);
      if (!kc?.taught) {
        untaught.push(kcId);
        return;
      }
      const due = kc.due;
      const value =
        priority(kcId) * (1 - (due ? kc.recallToday : kc.recallOnExamDay));
      if (!due && value <= 0) return;
      candidates.push({
        item: {
          kind: due ? "review" : "refresh",
          kcId,
          topicId: topic.id,
          value,
          minutes: pace.minutesPerReview,
        },
        group: due ? 0 : 2,
        at: [place, index],
        started: false,
        pinnedAt: Infinity,
      });
    });
    const value = untaught.reduce((sum, id) => sum + priority(id), 0);
    if (untaught.length === 0 || value <= 0) return;
    candidates.push({
      item: {
        kind: "topic",
        topicId: topic.id,
        untaught,
        value,
        minutes: untaught.length * pace.minutesPerKc,
      },
      group: inPlan ? 1 : 3,
      at: [place, -1],
      started: untaught.length < topic.kcs.length,
      pinnedAt,
    });
  });

  const perMinute = ({ item }: Ranked) =>
    item.minutes > 0 ? item.value / item.minutes : item.value;
  const courseOrder = (a: Ranked, b: Ranked) =>
    a.at[0] - b.at[0] || a.at[1] - b.at[1];
  let sorted: Ranked[];
  if (inFinalStretch(input.examDate, input.now)) {
    sorted = candidates.toSorted(
      (a, b) => perMinute(b) - perMinute(a) || courseOrder(a, b),
    );
  } else {
    const teaching = candidates.some((c) => c.group === 1);
    sorted = candidates
      .filter((c) => !(teaching && c.group === 2))
      .toSorted(
        (a, b) =>
          a.group - b.group ||
          (a.item.kind === "topic"
            ? Number(b.started) - Number(a.started) ||
              a.pinnedAt - b.pinnedAt ||
              perMinute(b) - perMinute(a)
            : b.item.value - a.item.value) ||
          courseOrder(a, b),
      );
  }
  return afterAnchors(
    sorted.map((c) => c.item),
    topics,
    input.prerequisites,
  );
}

/**
 * The items in their order, except that a Topic never comes before a Topic
 * among them that it builds on (one of its KCs needs a KC of the other),
 * unless both are on a cycle: the first Topic it builds on comes just
 * before it, after that Topic's own anchors.
 */
function afterAnchors(
  items: RankedItem[],
  topics: PlanTopic[],
  prerequisites: Array<{ from: string; to: string }>,
): RankedItem[] {
  const reach = topicReach(topics, prerequisites);
  const mustPrecede = (a: string, b: string) =>
    reach.get(a)!.has(b) && !reach.get(b)!.has(a);
  const left = [...items];
  const ordered: RankedItem[] = [];
  const anchorOf = (index: number) => {
    const item = left[index]!;
    if (item.kind !== "topic") return -1;
    return left.findIndex(
      (other) =>
        other.kind === "topic" && mustPrecede(other.topicId, item.topicId),
    );
  };
  while (left.length > 0) {
    // Each anchor builds on strictly less, so the chase ends.
    let next = 0;
    for (let anchor = anchorOf(next); anchor !== -1; anchor = anchorOf(next)) {
      next = anchor;
    }
    ordered.push(...left.splice(next, 1));
  }
  return ordered;
}

/** The Topics each Topic reaches over one or more Topic arrows, by id. */
function topicReach(
  topics: PlanTopic[],
  prerequisites: Array<{ from: string; to: string }>,
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
