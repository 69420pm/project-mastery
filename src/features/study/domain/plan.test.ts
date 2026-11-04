import { createEmptyCard, State } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_PACE,
  goalTopics,
  planProgress,
  planStudy,
  type PlanInput,
  type TopicChoice,
} from "./plan";
import { type KcSchedule } from "./replay";

const NOW = new Date("2026-10-01T12:00:00Z");
// 21 days left: the final week starts on 2026-10-15, 14 days from now.
const EXAM = "2026-10-22";

/** A taught KC whose card is strong and not due, so its Topic is learned. */
const learned: KcSchedule = {
  card: {
    ...createEmptyCard(NOW),
    state: State.Review,
    stability: 30,
    due: new Date("2026-10-30T12:00:00Z"),
    last_review: NOW,
  },
};

const topic = (id: string, kcs: string[]) => ({ id, name: `T ${id}`, kcs });

const plan = (
  overrides: Partial<Omit<PlanInput, "exam">> & {
    exam?: Partial<PlanInput["exam"]>;
  } = {},
) =>
  planStudy({
    topics: [topic("t1", ["a", "b"]), topic("t2", ["c"]), topic("t3", ["d"])],
    prerequisites: [],
    priorities: { a: 0.4, b: 0.3, c: 0.2, d: 0.1 },
    schedules: new Map(),
    choices: [],
    pace: DEFAULT_PACE,
    now: NOW,
    ...overrides,
    exam: { examDate: EXAM, goal: null, ...overrides.exam },
  });

const statuses = (result: ReturnType<typeof plan>) =>
  Object.fromEntries(result.topics.map((t) => [t.id, t.status]));

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
    // 7 of 10 is short; the Topic with 2 crosses it.
    expect([
      ...goalTopics(
        [...crossing.slice(0, 2), { id: "t3", priority: 1 }],
        "pass",
      ),
    ]).toEqual(["t1", "t2"]);
  });

  test("the rest are if time allows; a pin adds and a skip removes", () => {
    const choices: TopicChoice[] = [
      { topicId: "t3", choice: "pinned", createdAt: "2026-09-01T00:00:00Z" },
      { topicId: "t1", choice: "skipped", createdAt: "2026-09-01T00:00:00Z" },
    ];
    expect(statuses(plan({ exam: { goal: "pass" } }))).toEqual({
      t1: "in_plan",
      t2: "in_plan",
      t3: "if_time_allows",
    });
    const chosen = plan({ exam: { goal: "pass" }, choices });
    expect(statuses(chosen)).toEqual({
      t1: "skipped",
      t2: "in_plan",
      t3: "in_plan",
    });
    expect(chosen.order).toEqual(["t3", "t2"]);
  });

  test("without Priorities every Topic is in the plan in Course order", () => {
    const result = plan({ priorities: {}, exam: { goal: "pass" } });
    expect(new Set(Object.values(statuses(result)))).toEqual(
      new Set(["in_plan"]),
    );
    expect(result.order).toEqual(["t1", "t2", "t3"]);
  });
});

describe("the Phase", () => {
  test.each([
    ["the exam day", "2026-10-01", "final_week"],
    ["exactly 7 days", "2026-10-08", "final_week"],
    ["8 days", "2026-10-09", "build"],
  ])("with %s left the Phase is %s", (_, examDate, phase) => {
    expect(plan({ exam: { examDate } }).phase).toBe(phase);
  });

  test("deepens once every in-plan Topic is taught, ignoring the rest", () => {
    const schedules = new Map([
      ["a", learned],
      ["b", learned],
      ["c", learned],
    ]);
    // d's Priority 0 leaves t3 out of the plan for no goal.
    const priorities = { a: 0.4, b: 0.3, c: 0.2, d: 0 };
    expect(plan({ schedules, priorities }).phase).toBe("deepen");
    expect(plan({ schedules: new Map([["a", learned]]) }).phase).toBe("build");
  });

  test("has no Phase without an exam date or once it has passed", () => {
    for (const examDate of [null, "2026-09-30"]) {
      expect(plan({ exam: { examDate } }).phase).toBeNull();
    }
  });
});

describe("the plan order", () => {
  // Priority per minute: t2 0.5/30, t3 0.6/60, t1 0.1/30.
  const topics = [
    topic("t1", ["a"]),
    topic("t2", ["b"]),
    topic("t3", ["c", "d"]),
  ];
  const priorities = { a: 0.1, b: 0.5, c: 0.3, d: 0.3 };
  const order = (overrides: Partial<PlanInput> = {}) =>
    plan({ topics, priorities, ...overrides }).order;
  const pin = (topicId: string, createdAt: string): TopicChoice => ({
    topicId,
    choice: "pinned",
    createdAt,
  });

  test("ranks by priority per estimated minute", () => {
    expect(order()).toEqual(["t2", "t3", "t1"]);
  });

  test("puts pinned Topics first, earliest pin first, then in-progress ones", () => {
    const schedules = new Map([["c", learned]]);
    expect(order({ schedules })).toEqual(["t3", "t2", "t1"]);
    expect(
      order({
        schedules,
        choices: [
          pin("t2", "2026-09-02T00:00:00Z"),
          pin("t1", "2026-09-01T00:00:00Z"),
        ],
      }),
    ).toEqual(["t1", "t2", "t3"]);
  });

  test("never puts a Topic before an in-plan Topic with an arrow into it", () => {
    // t3 holds a Prerequisite of t2's KC, so t3 comes first.
    expect(order({ prerequisites: [{ from: "c", to: "b" }] })).toEqual([
      "t3",
      "t2",
      "t1",
    ]);
    // Topics on a cycle keep their rank order.
    expect(
      order({
        prerequisites: [
          { from: "c", to: "b" },
          { from: "b", to: "c" },
        ],
      }),
    ).toEqual(["t2", "t3", "t1"]);
  });
});

describe("the Progress", () => {
  /** A card not due, strong enough to be known, after `reps` ratings. */
  const card = (reps: number, due = "2026-10-30T12:00:00Z"): KcSchedule => ({
    card: { ...learned.card!, reps, due: new Date(due) },
  });
  const progress = (
    schedules: Record<string, KcSchedule>,
    overrides: {
      choices?: TopicChoice[];
      examDate?: string | null;
      firstAttemptAt?: string | null;
    } = {},
  ) => {
    const map = new Map(Object.entries(schedules));
    const examDate =
      overrides.examDate === undefined ? EXAM : overrides.examDate;
    return planProgress(
      plan({
        schedules: map,
        choices: overrides.choices ?? [],
        exam: { examDate },
      }),
      {
        topics: [
          topic("t1", ["a", "b"]),
          topic("t2", ["c"]),
          topic("t3", ["d"]),
        ],
        schedules: map,
        examDate,
        firstAttemptAt:
          overrides.firstAttemptAt === undefined
            ? "2026-09-20T23:00:00Z"
            : overrides.firstAttemptAt,
        now: NOW,
      },
    );
  };

  test("counts only known KCs reviewed after their teaching", () => {
    expect(
      progress({
        // Taught, without a Review yet.
        a: { card: null },
        // Rated Easy once: strong and not due, but never reviewed.
        b: card(1),
        // Reviewed once after its teaching.
        c: card(2),
        // Reviewed, but due again.
        d: card(3, "2026-10-01T00:00:00Z"),
      }),
    ).toEqual({ known: 1, total: 4, daysIn: 12, daysLeft: 21 });
  });

  test("leaves out the KCs of Topics outside the plan", () => {
    const skipped: TopicChoice = {
      topicId: "t2",
      choice: "skipped",
      createdAt: "2026-09-01T00:00:00Z",
    };
    expect(progress({ c: card(2) }, { choices: [skipped] })).toMatchObject({
      known: 0,
      total: 3,
    });
  });

  test("has no days without Attempts or an exam date, and 0 on the exam day", () => {
    expect(
      progress({}, { examDate: null, firstAttemptAt: null }),
    ).toMatchObject({ daysIn: null, daysLeft: null });
    expect(progress({}, { examDate: "2026-09-30" }).daysLeft).toBeNull();
    expect(progress({}, { examDate: "2026-10-01" }).daysLeft).toBe(0);
    expect(
      progress({}, { firstAttemptAt: "2026-10-01T00:00:00Z" }).daysIn,
    ).toBe(1);
  });
});
