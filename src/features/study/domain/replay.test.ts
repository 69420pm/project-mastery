import { describe, expect, test } from "vitest";
import {
  daysBetween,
  desiredRetention,
  finalWeekSweep,
  kcState,
  medianSeconds,
  projectedRecall,
  rateAttempt,
  replayCourse,
  replayKc,
  retrievability,
  sessionEnd,
  type AttemptHelp,
  type AttemptResult,
  type KcSchedule,
  type ReplayAttempt,
} from "./replay";

const ALL_ENDED = { ended: () => true, examDate: null, retention: 0.9 };

/** A `learn` attempt in session `sessionId` at `createdAt`, Good by default. */
const attempt = (
  sessionId: string,
  createdAt: string,
  result: AttemptResult = "full",
  help: AttemptHelp = "none",
  extra: Partial<ReplayAttempt> = {},
): ReplayAttempt => ({
  kcId: "k",
  sessionId,
  createdAt,
  kind: "learn",
  result,
  help,
  questionId: `${sessionId}@${createdAt}`,
  confidence: null,
  seconds: null,
  ...extra,
});

const dueDay = (schedule: ReturnType<typeof replayKc>) =>
  schedule?.card?.due.toISOString().slice(0, 10);

describe("rateAttempt", () => {
  test.each([
    ["wrong", "none", "Again", 1],
    ["full", "solution_shown", "Again", 1],
    ["partial", "solution_shown", "Again", 1],
    ["partial", "none", "Hard", 2],
    ["full", "some", "Hard", 2],
    ["full", "none", "Good", 3],
  ] as const)("%s with %s help is %s", (result, help, _, rating) => {
    expect(rateAttempt({ result, help })).toBe(rating);
  });

  const quick = {
    result: "full",
    help: "none",
    kind: "learn",
    confidence: 4,
    seconds: 20,
  } as const;

  test.each([
    ["confidence 4 and quicker than the median", quick, 4],
    ["seconds equal to the median", { ...quick, seconds: 30 }, 3],
    ["seconds above the median", { ...quick, seconds: 45 }, 3],
    ["confidence 3", { ...quick, confidence: 3 }, 3],
    ["no confidence", { ...quick, confidence: null }, 3],
    ["unknown seconds", { ...quick, seconds: null }, 3],
    ["some help", { ...quick, help: "some" }, 2],
    ["a partial result", { ...quick, result: "partial" }, 2],
    ["a wrong result", { ...quick, result: "wrong" }, 1],
    ["no median for its kind", { ...quick, kind: "pre" }, 3],
  ] as const)("Easy rule: %s is %s", (_, a, rating) => {
    expect(rateAttempt(a, { learn: 30 })).toBe(rating);
  });
});

describe("medianSeconds", () => {
  const at = (kind: "pre" | "learn", seconds: number | null, q: string) =>
    attempt("s", "2026-10-01T10:00:00Z", "full", "none", {
      kind,
      seconds,
      questionId: q,
    });

  test("is the median per kind over answered questions, counting a question once", () => {
    expect(
      medianSeconds([
        at("learn", 10, "a"),
        at("learn", 10, "a"),
        at("learn", 40, "b"),
        at("learn", 100, "c"),
        at("learn", null, "d"),
        at("pre", 8, "e"),
        at("pre", 12, "f"),
      ]),
    ).toEqual({ learn: 40, pre: 10 });
  });

  test("is empty without answered questions", () => {
    expect(medianSeconds([at("learn", null, "a")])).toEqual({});
  });
});

test("a quick, confident answer in the first session makes the next review later than a Good one", () => {
  const slow = attempt("s1", "2026-10-01T10:00:00Z", "full", "none", {
    questionId: "slow",
    confidence: 4,
    seconds: 100,
  });
  const quick = attempt("s1", "2026-10-01T10:00:00Z", "full", "none", {
    questionId: "quick",
    confidence: 4,
    seconds: 10,
  });
  const medians = medianSeconds([slow, quick]);
  const good = dueDay(replayKc([slow], { ...ALL_ENDED, medians }));
  const easy = dueDay(replayKc([quick], { ...ALL_ENDED, medians }));
  expect(easy! > good!).toBe(true);
});

test.each([
  ["pass", 0.85],
  ["good_grade", 0.9],
  ["master_everything", 0.93],
  [null, 0.9],
] as const)("the goal %s wants a retention of %s", (goal, retention) => {
  expect(desiredRetention(goal)).toBe(retention);
});

test("a higher retention brings the first review closer", () => {
  const [pass, master] = [0.85, 0.93].map((retention) =>
    dueDay(
      replayKc([attempt("s1", "2026-10-01T10:00:00Z")], {
        ...ALL_ENDED,
        retention,
      }),
    ),
  );
  expect(pass! > master!).toBe(true);
});

describe("replayKc", () => {
  test("has no schedule from prequestions alone, and ignores them later", () => {
    const pre = {
      ...attempt("s0", "2026-09-30T10:00:00Z", "wrong"),
      kind: "pre" as const,
    };

    expect(replayKc([pre], ALL_ENDED)).toBeNull();
    expect(
      replayKc([pre, attempt("s1", "2026-10-01T10:00:00Z")], ALL_ENDED),
    ).toEqual(replayKc([attempt("s1", "2026-10-01T10:00:00Z")], ALL_ENDED));
  });

  test("creates the card once the first session ends, with its last attempt", () => {
    const first = [
      attempt("s1", "2026-10-01T10:00:00Z", "wrong"),
      attempt("s1", "2026-10-01T10:20:00Z"),
    ];

    expect(replayKc(first, { ...ALL_ENDED, ended: () => false })).toEqual({
      card: null,
    });
    const { card } = replayKc(first, ALL_ENDED)!;
    expect(card!.last_review).toEqual(new Date("2026-10-01T10:20:00Z"));
    expect(dueDay({ card })).toBe("2026-10-04");
  });

  test("reviews only the first attempt of each later session, open or not", () => {
    const later = [
      attempt("s1", "2026-10-01T10:00:00Z"),
      attempt("s2", "2026-10-04T10:00:00Z", "wrong"),
      attempt("s2", "2026-10-04T10:10:00Z"),
    ];
    const ended = (id: string) => id === "s1";

    expect(replayKc(later, { ...ALL_ENDED, ended })).toEqual(
      replayKc(later.slice(0, 2), ALL_ENDED),
    );
    expect(replayKc(later, ALL_ENDED)!.card!.lapses).toBe(1);
  });

  test("skips a later session's first attempt that predates the card", () => {
    const overlapping = [
      attempt("s1", "2026-10-01T10:00:00Z"),
      attempt("s2", "2026-10-01T10:10:00Z", "wrong"),
      attempt("s1", "2026-10-01T10:30:00Z"),
    ];

    expect(replayKc(overlapping, ALL_ENDED)).toEqual(
      replayKc([overlapping[0]!, overlapping[2]!], ALL_ENDED),
    );
  });

  test("caps a due date at half the days left to the exam", () => {
    const options = { ...ALL_ENDED, examDate: "2026-10-06" };
    const good = [attempt("s1", "2026-10-01T10:00:00Z")];

    // Good gives 3 days; 5 days left allow 2.
    expect(dueDay(replayKc(good, options))).toBe("2026-10-03");
    // 1 day left still allows 1 day.
    const late = [attempt("s1", "2026-10-05T10:00:00Z")];
    expect(dueDay(replayKc(late, options))).toBe("2026-10-06");
    // No cap on or after the exam day.
    const after = [attempt("s1", "2026-10-06T10:00:00Z")];
    expect(dueDay(replayKc(after, options))).toBe("2026-10-09");
  });

  // Fixed sequences at retention 0.9 without an exam: the FSRS-6 defaults.
  test.each([
    {
      name: "Good, then Good on its due day",
      attempts: [
        attempt("s1", "2026-10-01T10:00:00Z"),
        attempt("s2", "2026-10-04T09:00:00Z"),
      ],
      due: "2026-10-18",
      stability: 13.8269,
    },
    {
      name: "Again, Good the next day, then Hard",
      attempts: [
        attempt("s1", "2026-10-01T10:00:00Z", "wrong"),
        attempt("s2", "2026-10-02T10:00:00Z"),
        attempt("s3", "2026-10-05T10:00:00Z", "partial"),
      ],
      due: "2026-10-10",
      stability: 5.3457,
    },
    {
      name: "Good, Good, Hard with help, then Again late",
      attempts: [
        attempt("s1", "2026-10-01T10:00:00Z"),
        attempt("s2", "2026-10-04T10:00:00Z"),
        attempt("s3", "2026-10-20T10:00:00Z", "full", "some"),
        attempt("s4", "2026-11-30T10:00:00Z", "wrong"),
      ],
      due: "2026-12-03",
      stability: 2.6822,
    },
  ])("replays $name", ({ attempts, due, stability }) => {
    const { card } = replayKc(attempts, ALL_ENDED)!;

    expect(dueDay({ card })).toBe(due);
    expect(card!.stability).toBeCloseTo(stability, 4);
  });
});

test("replayCourse schedules each taught KC with the goal's retention", () => {
  const course = [
    { ...attempt("s1", "2026-10-01T10:00:00Z"), kcId: "a" },
    {
      ...attempt("s1", "2026-10-01T10:00:00Z"),
      kcId: "p",
      kind: "pre" as const,
    },
  ];
  const options = { ended: () => true, examDate: null, priorities: {} };

  const schedules = replayCourse(course, {
    ...options,
    goal: "pass",
    today: "2026-10-02",
  });

  expect([...schedules.keys()]).toEqual(["a"]);
  expect(schedules.get("a")).toEqual(
    replayKc(course.slice(0, 1), { ...ALL_ENDED, retention: 0.85 }),
  );
});

describe("finalWeekSweep", () => {
  const base = replayKc(
    [attempt("s1", "2026-10-01T10:00:00Z")],
    ALL_ENDED,
  )!.card!;
  /** A card last reviewed on `last`, due on 2026-12-20. */
  const reviewed = (last: string) => ({
    card: { ...base, last_review: new Date(last), due: new Date("2026-12-20") },
  });
  const schedules = new Map<string, KcSchedule>([
    ["a", reviewed("2026-11-10")],
    ["b", reviewed("2026-11-22")],
    ["c", reviewed("2026-11-01")],
    ["open", { card: null }],
    ["none", reviewed("2026-11-01")],
  ]);
  const options = {
    examDate: "2026-11-30",
    priorities: { a: 0.9, b: 0.5, c: 0.1 },
    today: "2026-11-25",
  };
  const dueDays = (swept: Map<string, KcSchedule>) =>
    [...swept].map(([kcId, schedule]) => [kcId, dueDay(schedule)]);

  test("makes the top half by Priority due 3 days before the exam, unless reviewed within 7 days", () => {
    expect(dueDays(finalWeekSweep(schedules, options))).toEqual([
      ["a", "2026-11-27"],
      ["b", "2026-12-20"],
      ["c", "2026-12-20"],
      ["open", undefined],
      ["none", "2026-12-20"],
    ]);
  });

  test("does nothing once the exam has passed or without one", () => {
    const untouched = dueDays(schedules);

    expect(
      dueDays(finalWeekSweep(schedules, { ...options, today: "2026-12-01" })),
    ).toEqual(untouched);
    expect(
      dueDays(finalWeekSweep(schedules, { ...options, examDate: null })),
    ).toEqual(untouched);
  });
});

describe("kcState", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const card = (due: string, stability: number) => ({
    card: {
      ...replayKc([attempt("s1", "2026-10-01T10:00:00Z")], ALL_ENDED)!.card!,
      due: new Date(due),
      stability,
    },
  });

  test("is new without a schedule, learning with recall unknown in its first session", () => {
    expect(kcState(undefined, now)).toEqual({
      state: "new",
      nextReview: null,
      retrievability: null,
    });
    expect(kcState({ card: null }, now)).toEqual({
      state: "learning",
      nextReview: null,
      retrievability: null,
    });
  });

  test.each([
    ["2026-10-10T23:00:00Z", 30, "due"],
    ["2026-10-11T00:00:00Z", 6.9, "learning"],
    ["2026-10-11T00:00:00Z", 7, "known"],
  ])("due %s with stability %s is %s", (due, stability, state) => {
    const kc = kcState(card(due, stability), now);

    expect(kc.state).toBe(state);
    expect(kc.nextReview).toBe(due.slice(0, 10));
    expect(kc.retrievability).toBeGreaterThan(0);
    expect(kc.retrievability).toBeLessThan(1);
  });
});

describe("projectedRecall", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const card = replayKc(
    [attempt("s1", "2026-10-01T10:00:00Z")],
    ALL_ENDED,
  )!.card!;
  const today = retrievability(card, now);

  test("is the recall on the exam date while the exam is ahead", () => {
    const projected = projectedRecall(card, now, "2026-10-20");

    expect(projected).toBe(retrievability(card, new Date("2026-10-20")));
    expect(projected).toBeLessThan(today);
  });

  test.each([
    ["no exam", null],
    ["an exam today", "2026-10-10"],
    ["a past exam", "2026-10-01"],
  ])("is today's recall with %s", (_, examDate) => {
    expect(projectedRecall(card, now, examDate)).toBe(today);
  });
});

test("a session ends at ended_at, or at its last message after 2 hours idle", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const ended = "2026-10-01T11:00:00Z";

  expect(sessionEnd({ endedAt: ended, newestMessageAt: null }, now)).toBe(
    ended,
  );
  expect(
    sessionEnd({ endedAt: null, newestMessageAt: "2026-10-01T09:59:59Z" }, now),
  ).toBe("2026-10-01T09:59:59Z");
  expect(
    sessionEnd({ endedAt: null, newestMessageAt: "2026-10-01T10:00:00Z" }, now),
  ).toBeNull();
  expect(sessionEnd({ endedAt: null, newestMessageAt: null }, now)).toBeNull();
});

test("daysBetween counts UTC days", () => {
  expect(daysBetween("2026-10-01", "2026-10-04")).toBe(3);
  expect(daysBetween("2026-10-04", "2026-10-01")).toBe(-3);
});
