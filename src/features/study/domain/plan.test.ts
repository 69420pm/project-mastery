import { createEmptyCard, State, type Card } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_PACE,
  goalTopics,
  planStudy,
  type PlanInput,
  type TopicChoice,
} from "./plan";
import {
  forecastReviews,
  replayKc,
  utcDay,
  type KcSchedule,
  type ReplayAttempt,
} from "./replay";

const NOW = new Date("2026-10-01T12:00:00Z");
// 21 days left: the final week starts on 2026-10-15, 14 days from now.
const EXAM = "2026-10-22";
const UNTIL = "2026-10-15";

/** A taught KC whose card is strong and not due, so its Topic is learned. */
const learned: KcSchedule = {
  card: {
    ...createEmptyCard<Card>(NOW),
    state: State.Review,
    stability: 30,
    due: new Date("2026-10-30T12:00:00Z"),
    last_review: NOW,
  },
};

/** A Good `learn` attempt in its own session at `at`, as in the replay. */
const good = (at: string): ReplayAttempt => ({
  kcId: "k",
  sessionId: at,
  createdAt: at,
  kind: "learn",
  result: "full",
  help: "none",
  questionId: at,
  confidence: null,
  seconds: null,
});

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
    exam: { examDate: EXAM, hoursPerWeek: 10, goal: null, ...overrides.exam },
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

  test("has no Phase and no fit without an exam date or once it has passed", () => {
    for (const examDate of [null, "2026-09-30"]) {
      expect(plan({ exam: { examDate } })).toMatchObject({
        phase: null,
        fit: null,
      });
    }
  });

  test("has no fit in the final week or without weekly hours", () => {
    expect(plan({ exam: { examDate: "2026-10-05" } }).fit).toBeNull();
    expect(plan({ exam: { hoursPerWeek: null } }).fit).toBeNull();
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

describe("the fit", () => {
  const forecast = { now: NOW, until: UNTIL, examDate: EXAM, retention: 0.9 };
  const fresh = forecastReviews(null, forecast);
  /** Weekly hours for a budget of `kcs` KCs at the default pace. */
  const hoursFor = (kcs: number) => (kcs * (30 + fresh * 2) * 7) / (14 * 60);

  test("fits Topics in plan order until the first that doesn't", () => {
    // Order t1 (2 KCs), t2, t3; 2.5 KCs fit t1 only, and stop at t2.
    const result = plan({ exam: { hoursPerWeek: hoursFor(2.5) } });
    expect(result.topics.map((t) => t.fits)).toEqual([true, false, false]);
    expect(result.fit).toEqual({ fitting: 1, inPlan: 3, examWeight: 70 });
  });

  test("a taught Topic counts toward the fit and its exam weight", () => {
    const schedules = new Map([["c", learned]]);
    const result = plan({ schedules, exam: { hoursPerWeek: hoursFor(2.5) } });
    expect(result.topics.map((t) => t.fits)).toEqual([true, null, false]);
    expect(result.fit).toEqual({ fitting: 2, inPlan: 3, examWeight: 90 });
  });

  test("a faster pace fits more", () => {
    const result = plan({
      exam: { hoursPerWeek: hoursFor(2.5) },
      pace: { minutesPerKc: 10, minutesPerReview: 1 },
    });
    expect(result.fit).toEqual({ fitting: 3, inPlan: 3, examWeight: 100 });
  });

  test("the existing cards' reviews come out of the budget", () => {
    // A card taught yesterday, which comes back several times.
    const due = replayKc([good("2026-09-30T10:00:00Z")], {
      ended: () => true,
      examDate: EXAM,
      retention: 0.9,
    })!;
    const result = plan({
      topics: [topic("t1", ["a"])],
      schedules: new Map([["z", due]]),
      exam: { hoursPerWeek: hoursFor(1) },
    });
    expect(result.topics[0]!.fits).toBe(false);
  });
});

describe("forecastReviews", () => {
  const options = { ended: () => true, examDate: EXAM, retention: 0.9 };

  test("counts the Good reviews the replay would schedule before the final week", () => {
    const history = [
      good("2026-09-20T10:00:00Z"),
      good("2026-09-24T10:00:00Z"),
    ];
    const card = replayKc(history, options)!.card!;
    // Extend the history with a Good review on every due day.
    let replayed = card;
    let expected = 0;
    while (utcDay(replayed.due < NOW ? NOW : replayed.due) < UNTIL) {
      const at = replayed.due < NOW ? NOW : replayed.due;
      history.push(good(at.toISOString()));
      replayed = replayKc(history, options)!.card!;
      expected++;
    }
    expect(expected).toBeGreaterThan(0);
    expect(
      forecastReviews(card, {
        now: NOW,
        until: UNTIL,
        examDate: EXAM,
        retention: 0.9,
      }),
    ).toBe(expected);
  });
});
