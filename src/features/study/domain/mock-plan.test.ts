import { describe, expect, test } from "vitest";
import { examProfile, itemMinutes } from "./exam-profile";
import {
  fillMock,
  mockTotals,
  planGaps,
  planMock,
  predictedSuccess,
  type MockCandidate,
  type MockSlot,
} from "./mock-plan";

const minutesOf = (slots: MockSlot[]) =>
  slots.reduce((sum, slot) => sum + itemMinutes(slot.difficulty), 0);

describe("planMock", () => {
  test("Topics share the minutes by priority within one slot, and the points split near 30/50/20", () => {
    const topics = [
      { id: "a", priority: 3 },
      { id: "b", priority: 2 },
      { id: "c", priority: 1 },
    ];
    const slots = planMock(topics);

    const total = minutesOf(slots);
    expect(total).toBeLessThanOrEqual(90);
    expect(total).toBeGreaterThan(90 - 20);
    for (const topic of topics) {
      const share = minutesOf(slots.filter((s) => s.topicId === topic.id));
      expect(Math.abs(share - (90 * topic.priority) / 6)).toBeLessThanOrEqual(
        20,
      );
    }
    for (const [difficulty, part] of [
      [1, 0.3],
      [2, 0.5],
      [3, 0.2],
    ] as const) {
      const points = minutesOf(
        slots.filter((s) => s.difficulty === difficulty),
      );
      // Within half the largest slot.
      expect(Math.abs(points - total * part)).toBeLessThan(10);
    }
    // Topic order, then difficulty.
    expect(slots[0]).toEqual({ topicId: "a", difficulty: 1 });
    expect(slots.at(-1)?.topicId).toBe("c");
  });

  test("Topics without priority share equally; no Topics give no slots", () => {
    const slots = planMock([
      { id: "a", priority: 0 },
      { id: "b", priority: 0 },
    ]);
    const a = minutesOf(slots.filter((s) => s.topicId === "a"));
    const b = minutesOf(slots.filter((s) => s.topicId === "b"));
    expect(Math.abs(a - b)).toBeLessThanOrEqual(20);
    expect(planMock([])).toEqual([]);
  });
});

const candidate = (
  id: string,
  source: MockCandidate["source"],
  difficulty: number,
  more: Partial<MockCandidate> = {},
): MockCandidate => ({
  id,
  kind: source === "old_exam" || source === "exercise" ? "exercise" : "problem",
  source,
  kcs: ["k1"],
  difficulty,
  seen: false,
  ...more,
});

const topicKcs = new Map([
  ["t1", ["k1"]],
  ["t2", ["k2"]],
]);

describe("fillMock", () => {
  test("takes old exams, then Exercises, then variants, then new Problems, each at the nearest difficulty, and none twice", () => {
    const slots: MockSlot[] = [
      { topicId: "t1", difficulty: 2 },
      { topicId: "t1", difficulty: 2 },
      { topicId: "t1", difficulty: 2 },
      { topicId: "t1", difficulty: 2 },
      { topicId: "t1", difficulty: 2 },
    ];
    const filled = fillMock(slots, topicKcs, [
      candidate("new", "new", 2),
      candidate("variant", "variant", 2),
      candidate("exercise", "exercise", 2),
      candidate("exam-far", "old_exam", 3),
      candidate("exam-near", "old_exam", 2),
    ]);

    expect(filled.map((item) => item?.id ?? null)).toEqual([
      "exam-near",
      "exam-far",
      "exercise",
      "variant",
      "new",
    ]);
  });

  test("leaves out seen, flagged and reserved items, and those of other Topics", () => {
    const filled = fillMock([{ topicId: "t1", difficulty: 1 }], topicKcs, [
      candidate("seen", "old_exam", 1, { seen: true }),
      candidate("reserved", "old_exam", 1, { reserved: true }),
      candidate("flagged", "variant", 1, { flagged: true }),
      candidate("other", "exercise", 1, { kcs: ["k2"] }),
    ]);

    expect(filled).toEqual([null]);
  });
});

describe("planGaps", () => {
  const slots: Array<MockSlot | null> = [
    null,
    { topicId: "t1", difficulty: 3 },
    { topicId: "t1", difficulty: 1 },
    { topicId: "t2", difficulty: 2 },
  ];

  test("varies a seen Exercise of the Topic once, else a new Problem for its top-priority KC", () => {
    const gaps = planGaps(
      slots,
      new Map([
        ["t1", ["k1"]],
        ["t2", ["k2", "k3"]],
      ]),
      [
        { id: "x-unseen", kcs: ["k1"], difficulty: 3, seen: false },
        { id: "x-seen", kcs: ["k1"], difficulty: 2, seen: true },
      ],
      { k2: 0.1, k3: 0.5 },
    );

    expect(gaps).toEqual([
      {
        slot: 1,
        problem: {
          source: "variant",
          exerciseId: "x-seen",
          kcs: ["k1"],
          difficulty: 2,
        },
      },
      { slot: 2, problem: { source: "new", kcs: ["k1"], difficulty: 1 } },
      { slot: 3, problem: { source: "new", kcs: ["k3"], difficulty: 2 } },
    ]);
  });

  test("fills at most 6 empty slots", () => {
    const many = Array.from({ length: 8 }, () => ({
      topicId: "t1",
      difficulty: 1 as const,
    }));
    expect(planGaps(many, topicKcs, [], {})).toHaveLength(6);
  });
});

test("a mock lasts its items' minutes, so dropped slots shorten it, and scores points times success", () => {
  const recall = new Map<string, number | null>([
    ["k1", 0.8],
    ["k2", null],
  ]);
  expect(predictedSuccess(["k1", "k2", "k3"], recall)).toBeCloseTo(0.8 / 3);
  expect(predictedSuccess([], recall)).toBe(0);

  const items = [
    { points: itemMinutes(3), predictedSuccess: 0.5 },
    { points: itemMinutes(1), predictedSuccess: 1 },
  ];
  expect(mockTotals(items)).toEqual({
    durationMinutes: 26,
    predictedScore: 16,
  });
  expect(mockTotals(items.slice(1)).durationMinutes).toBe(6);
});

test("examProfile lists the Brief's aids for 90 minutes", () => {
  expect(
    examProfile({ openBook: false, formulaSheet: true, calculator: true }),
  ).toEqual({ minutes: 90, aids: ["Formula sheet", "Calculator"] });
  expect(
    examProfile({ openBook: null, formulaSheet: null, calculator: null }).aids,
  ).toEqual([]);
});
