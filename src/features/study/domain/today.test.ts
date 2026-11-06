import { describe, expect, test } from "vitest";
import { DEFAULT_PACE, type Pace, type Plan, type TopicPlan } from "./plan";
import { UNTAUGHT, type KcRecall } from "./replay";
import type { TopicStateName } from "./topic-state";
import { planToday } from "./today";

const topic = (
  id: string,
  state: TopicStateName,
  overrides: Partial<TopicPlan> = {},
): TopicPlan => ({
  id,
  name: `T ${id}`,
  priority: 1,
  topicState: { state, recall: 0.5 },
  status: "in_plan",
  pinned: false,
  untaught: [],
  ...overrides,
});

const today = (
  plan: Partial<Plan & { pace: Pace }>,
  input: { dueCount?: number; recall?: Map<string, KcRecall> } = {},
) =>
  planToday(
    {
      phase: "build",
      topics: [],
      order: [],
      pace: DEFAULT_PACE,
      ...plan,
    },
    {
      topics: (plan.topics ?? []).map((t) => ({
        id: t.id,
        centralQuestion: `Why ${t.id}?`,
        kcs: [`${t.id}-kc`],
      })),
      recall: input.recall ?? new Map(),
      dueCount: input.dueCount ?? 0,
    },
  );

/** A taught KC with the given recall on the exam day. */
const recalled = (recallOnExamDay: number): KcRecall => ({
  ...UNTAUGHT,
  taught: true,
  recallToday: 1,
  recallOnExamDay,
});

describe("planToday", () => {
  test("counts the due reviews in minutes at the pace, and none when none are due", () => {
    expect(today({}, { dueCount: 3 }).reviews).toEqual({
      count: 3,
      minutes: 6,
    });
    expect(today({}).reviews).toBeNull();
  });

  test("rounds the review minutes at a measured, fractional pace", () => {
    const pace: Pace = { ...DEFAULT_PACE, minutesPerReview: 0.85 };
    expect(today({ pace }, { dueCount: 7 }).reviews?.minutes).toBe(6);
    expect(today({ pace }, { dueCount: 1 }).reviews?.minutes).toBe(1);
  });

  test.each([["build" as const], [null]])(
    "in %s takes the first Topic of the plan order, without a hint",
    (phase) => {
      const result = today({
        phase,
        topics: [topic("a", "new"), topic("b", "in_progress")],
        order: ["b", "a"],
      });
      expect(result.next).toEqual({
        id: "b",
        name: "T b",
        centralQuestion: "Why b?",
        kcs: ["b-kc"],
      });
      expect(result.hint).toBeNull();
    },
  );

  test("has no next Topic when the plan order is empty", () => {
    expect(today({ topics: [topic("a", "learned")] }).next).toBeNull();
  });

  test("in Deepen takes the learned Topic with the lowest recall, otherwise a solid one", () => {
    const low = { topicState: { state: "learned" as const, recall: 0.2 } };
    const topics = [
      topic("s", "solid"),
      topic("a", "learned"),
      topic("b", "learned", low),
    ];
    const result = today({ phase: "deepen", topics });
    expect(result.next?.id).toBe("b");
    expect(result.hint).toBe("Practice exam-style problems");
    expect(today({ phase: "deepen", topics: [topics[0]!] }).next?.id).toBe("s");
  });

  test("in the final week takes the taught Topic with the highest priority × (1 − recall on the exam day)", () => {
    const recall = new Map([
      ["a-kc", recalled(0.95)],
      ["b-kc", recalled(0.3)],
    ]);
    const result = today(
      {
        phase: "final_week",
        topics: [
          topic("a", "solid", { priority: 2 }),
          topic("b", "learned", { priority: 1 }),
          topic("c", "new", { priority: 5 }),
          topic("d", "learned", { priority: 9, status: "skipped" }),
        ],
      },
      { recall },
    );
    expect(result.next?.id).toBe("b");
    expect(result.hint).toBe("Try an old exam under exam conditions");
  });
});
