import { describe, expect, test } from "vitest";
import {
  goalTopics,
  planProgress,
  planScope,
  topicBadges,
  type TopicChoice,
} from "./plan";
import type { KcRecall } from "./replay";

const NOW = new Date("2026-10-01T12:00:00Z");

const TOPICS = [
  { id: "t1", kcs: ["a", "b"] },
  { id: "t2", kcs: ["c"] },
  { id: "t3", kcs: ["d"] },
];
const PRIORITIES = { a: 0.4, b: 0.3, c: 0.2, d: 0.1 };

const statuses = (choices: TopicChoice[] = []) =>
  Object.fromEntries(
    planScope({
      topics: TOPICS,
      priorities: PRIORITIES,
      goal: "pass",
      choices,
    }).map((t) => [t.id, t.status]),
  );

describe("the goal's Topics", () => {
  const topics = [
    { id: "t1", priority: 5 },
    { id: "t2", priority: 3 },
    { id: "t3", priority: 2 },
    { id: "t4", priority: 0 },
  ];

  test.each([
    ["pass stops once 80% is reached", "pass", ["t1", "t2"]],
    ["a good grade takes priority above 0", "good_grade", ["t1", "t2", "t3"]],
    ["no goal takes priority above 0", null, ["t1", "t2", "t3"]],
    [
      "master everything takes all",
      "master_everything",
      ["t1", "t2", "t3", "t4"],
    ],
  ] as const)("%s", (_, goal, expected) => {
    expect([...goalTopics(topics, goal)]).toEqual(expected);
  });

  test("pass includes the Topic crossing 80%", () => {
    const crossing = [
      { id: "t1", priority: 5 },
      { id: "t2", priority: 2 },
      { id: "t3", priority: 3 },
    ];
    // 5, then 3 (to 8 of 10), then stop.
    expect([...goalTopics(crossing, "pass")]).toEqual(["t1", "t3"]);
  });
});

describe("the plan scope", () => {
  test("the rest are if time allows; a pin adds and a skip removes", () => {
    expect(statuses()).toEqual({
      t1: "in_plan",
      t2: "in_plan",
      t3: "if_time_allows",
    });
    const pinnedAt = "2026-09-01T00:00:00Z";
    expect(
      statuses([
        { topicId: "t3", choice: "pinned", createdAt: pinnedAt },
        { topicId: "t1", choice: "skipped", createdAt: pinnedAt },
      ]),
    ).toEqual({ t1: "skipped", t2: "in_plan", t3: "in_plan" });
  });

  test("badges name the pin, the skip and if time allows", () => {
    expect(
      topicBadges({ id: "t", status: "in_plan", pinnedAt: "2026-09-01" }),
    ).toEqual(["pinned"]);
    expect(
      topicBadges({ id: "t", status: "if_time_allows", pinnedAt: null }),
    ).toEqual(["if time allows"]);
  });
});

describe("the Progress", () => {
  const recall = (learned: boolean): KcRecall => ({
    taught: true,
    learned,
    recallToday: 0.5,
    recallOnExamDay: 0.4,
    due: true,
    nextReview: "2026-09-30",
  });
  const progress = (overrides: {
    examDate?: string | null;
    firstAttemptAt?: string | null;
  }) =>
    planProgress({
      topics: TOPICS,
      scope: planScope({
        topics: TOPICS,
        priorities: PRIORITIES,
        goal: "pass",
        choices: [],
      }),
      // A learned KC stays counted while due and with low recall.
      recall: new Map([
        ["a", recall(true)],
        ["b", recall(false)],
        ["d", recall(true)],
      ]),
      examDate: "2026-10-22",
      firstAttemptAt: "2026-09-25T08:00:00Z",
      now: NOW,
      ...overrides,
    });

  test("counts the learned KCs of the in-plan Topics, with days in and left", () => {
    // d is learned but its Topic is only if time allows.
    expect(progress({})).toEqual({
      learned: 1,
      total: 3,
      daysIn: 7,
      daysLeft: 21,
    });
  });

  test("has no days without Attempts or an exam date, and 0 on the exam day", () => {
    expect(progress({ examDate: null, firstAttemptAt: null })).toMatchObject({
      daysIn: null,
      daysLeft: null,
    });
    expect(progress({ examDate: "2026-10-01" }).daysLeft).toBe(0);
    expect(progress({ examDate: "2026-09-30" }).daysLeft).toBeNull();
  });
});
