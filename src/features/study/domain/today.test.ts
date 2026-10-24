import { createEmptyCard, State, type Card } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import { DEFAULT_PACE, type Plan, type TopicPlan } from "./plan";
import type { KcSchedule } from "./replay";
import type { TopicStateName } from "./topic-state";
import { planToday } from "./today";

const NOW = new Date("2026-10-01T12:00:00Z");
const EXAM = "2026-10-05";

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
  fits: null,
  ...overrides,
});

const today = (
  plan: Partial<Plan>,
  input: { dueCount?: number; schedules?: Map<string, KcSchedule> } = {},
) =>
  planToday(
    {
      phase: "build",
      topics: [],
      order: [],
      fit: null,
      pace: DEFAULT_PACE,
      ...plan,
    },
    {
      topics: (plan.topics ?? []).map((t) => ({
        id: t.id,
        centralQuestion: `Why ${t.id}?`,
        kcs: [`${t.id}-kc`],
      })),
      schedules: input.schedules ?? new Map(),
      dueCount: input.dueCount ?? 0,
      examDate: EXAM,
      now: NOW,
    },
  );

/** A card reviewed today with the given stability in days. */
const card = (stability: number): KcSchedule => ({
  card: {
    ...createEmptyCard<Card>(NOW),
    state: State.Review,
    stability,
    due: new Date("2026-11-30T12:00:00Z"),
    last_review: NOW,
  },
});

describe("planToday", () => {
  test("counts the due reviews in minutes at the pace, and none when none are due", () => {
    expect(today({}, { dueCount: 3 }).reviews).toEqual({
      count: 3,
      minutes: 6,
    });
    expect(today({}).reviews).toBeNull();
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

  test("in Deepen takes a needs-work Topic, otherwise the learned one with the lowest recall", () => {
    const low = { topicState: { state: "learned" as const, recall: 0.2 } };
    const topics = [topic("a", "learned"), topic("b", "learned", low)];
    expect(today({ phase: "deepen", topics }).next?.id).toBe("b");
    const withWork = [...topics, topic("c", "needs_work")];
    const result = today({ phase: "deepen", topics: withWork });
    expect(result.next?.id).toBe("c");
    expect(result.hint).toBe("Practice exam-style problems");
  });

  test("in the final week takes the taught Topic with the highest priority × (1 − projected recall)", () => {
    const schedules = new Map([
      ["a-kc", card(100)],
      ["b-kc", card(1)],
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
      { schedules },
    );
    expect(result.next?.id).toBe("b");
    expect(result.hint).toBe("Try an old exam under exam conditions");
  });
});
