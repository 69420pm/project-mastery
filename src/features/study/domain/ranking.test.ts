import { describe, expect, test } from "vitest";
import { DEFAULT_PACE, type TopicScope } from "./plan";
import { inFinalStretch, rankNext, type RankedItem } from "./ranking";
import type { KcRecall } from "./replay";

const NOW = new Date("2026-10-01T12:00:00Z");
const FAR = "2026-12-01";

// t1 (a, b), t2 (c), t3 (d); a weighs most.
const TOPICS = [
  { id: "t1", kcs: ["a", "b"] },
  { id: "t2", kcs: ["c"] },
  { id: "t3", kcs: ["d"] },
];

const taught = (recall: number, due = false): KcRecall => ({
  taught: true,
  learned: true,
  recallToday: recall,
  recallOnExamDay: recall - 0.1,
  due,
  nextReview: due ? "2026-10-01" : "2026-10-20",
});

const inPlan = (id: string, pinnedAt: string | null = null): TopicScope => ({
  id,
  status: "in_plan",
  pinnedAt,
});

const rank = (overrides: Partial<Parameters<typeof rankNext>[0]> = {}) =>
  rankNext({
    topics: TOPICS,
    prerequisites: [],
    priorities: { a: 0.6, b: 0.4, c: 0.5, d: 0.2 },
    recall: new Map(),
    pace: DEFAULT_PACE,
    scope: TOPICS.map((t) => inPlan(t.id)),
    examDate: FAR,
    now: NOW,
    ...overrides,
  });

/** Each item as `kind:id`. */
const names = (items: RankedItem[]) =>
  items.map((i) => `${i.kind}:${i.kind === "topic" ? i.topicId : i.kcId}`);

describe("rankNext", () => {
  test("a late starter 4 days out gets the untaught Topics by Priority per minute", () => {
    // t1: 1.2 over 60 min; t2: 0.5 over 30; t3: 0.2 over 30.
    const priorities = { a: 0.6, b: 0.6, c: 0.5, d: 0.2 };
    expect(names(rank({ examDate: "2026-10-05", priorities }))).toEqual([
      "topic:t1",
      "topic:t2",
      "topic:t3",
    ]);
    expect(
      names(rank({ examDate: "2026-10-05", priorities: { d: 1 } })),
    ).toEqual(["topic:t3"]);
  });

  test("everything taught with the exam far off gives refreshes after due Reviews", () => {
    const items = rank({
      recall: new Map([
        ["a", taught(0.9)],
        ["b", taught(0.3, true)],
        ["c", taught(0.5)],
        ["d", taught(1.1)],
      ]),
    });
    // b is due; a and c refresh by value; d recalls fully, so it is dropped.
    expect(names(items)).toEqual(["review:b", "refresh:c", "refresh:a"]);
    expect(items[0]!.value).toBeCloseTo(0.28);
    expect(items[0]!.minutes).toBe(2);
  });

  test("keeps a due Review of value 0 and holds refreshes back while an in-plan Topic is untaught", () => {
    const items = rank({
      priorities: { a: 0, b: 0.4, c: 0.5, d: 0.2 },
      recall: new Map([
        ["a", taught(0.5, true)],
        ["c", taught(0.5)],
      ]),
    });
    expect(names(items)).toEqual(["review:a", "topic:t1", "topic:t3"]);
  });

  test("never passes an anchor Topic, which comes just before the Topic that builds on it", () => {
    // t1 ranks first and builds on t3, whose value per minute is lowest.
    const items = rank({
      priorities: { a: 0.6, b: 0.6, c: 0.5, d: 0.2 },
      prerequisites: [{ from: "d", to: "a" }],
    });
    expect(names(items)).toEqual(["topic:t3", "topic:t1", "topic:t2"]);
  });

  test("puts a started Topic first, then pinned ones, earliest pin first", () => {
    expect(
      names(
        rank({
          recall: new Map([["b", taught(0.9)]]),
          scope: [
            inPlan("t1"),
            inPlan("t2", "2026-09-02T00:00:00Z"),
            inPlan("t3", "2026-09-01T00:00:00Z"),
          ],
        }),
      ),
    ).toEqual(["topic:t1", "topic:t3", "topic:t2"]);
  });

  test("leaves skipped Topics out and ranks if-time-allows Topics after the refreshes", () => {
    const items = rank({
      recall: new Map([
        ["a", taught(0.8)],
        ["b", taught(0.8)],
      ]),
      scope: [
        inPlan("t1"),
        { id: "t2", status: "skipped", pinnedAt: null },
        { id: "t3", status: "if_time_allows", pinnedAt: null },
      ],
    });
    expect(names(items)).toEqual(["refresh:a", "refresh:b", "topic:t3"]);
  });

  test("ranks equal Priorities in Course order", () => {
    const equal = { a: 1, b: 1, c: 1, d: 1 };
    // Every Topic is worth the same per minute.
    expect(names(rank({ priorities: equal }))).toEqual([
      "topic:t1",
      "topic:t2",
      "topic:t3",
    ]);
  });

  test("ranks normally without an exam date or once it has passed", () => {
    const recall = new Map([["c", taught(0.5)]]);
    for (const examDate of [null, "2026-09-20"]) {
      expect(names(rank({ examDate, recall }))).toEqual([
        "topic:t1",
        "topic:t3",
      ]);
    }
  });

  test("in the final stretch ranks refreshes and Topics together", () => {
    const items = rank({
      examDate: "2026-10-08",
      recall: new Map([["c", taught(0.2)]]),
    });
    // c refreshes at 0.5 × 0.9 over 2 min, ahead of every Topic.
    expect(names(items)).toEqual(["refresh:c", "topic:t1", "topic:t3"]);
  });
});

test("the final stretch is the exam day and the 7 days before it", () => {
  expect(inFinalStretch("2026-10-08", NOW)).toBe(true);
  expect(inFinalStretch("2026-10-01", NOW)).toBe(true);
  expect(inFinalStretch("2026-10-09", NOW)).toBe(false);
  expect(inFinalStretch("2026-09-30", NOW)).toBe(false);
  expect(inFinalStretch(null, NOW)).toBe(false);
});
