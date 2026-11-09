import { fsrs } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import {
  daysBetween,
  desiredRetention,
  rateAttempt,
  replayCard,
  replayCourse,
  retrievability,
  type AttemptHelp,
  type AttemptResult,
  type Goal,
  type ReplayAttempt,
} from "./replay";

/** An attempt on KC `k` in session `sessionId` at `createdAt`, Good by default. */
const attempt = (
  sessionId: string,
  createdAt: string,
  result: AttemptResult = "full",
  help: AttemptHelp = "none",
): ReplayAttempt => ({
  kcId: "k",
  sessionId,
  createdAt,
  result,
  help,
  seconds: null,
});

/** KC `k`'s recall at `now`, without an exam and with no goal. */
const replay = (
  attempts: ReplayAttempt[],
  now: string,
  {
    examDate = null,
    goal = null,
  }: { examDate?: string | null; goal?: Goal } = {},
) => replayCourse(attempts, { examDate, goal, now: new Date(now) }).get("k");

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
});

describe("the per-day rule", () => {
  const NOW = "2026-10-01T20:00:00Z";

  test("a first day with several Attempts is taught by its newest so far", () => {
    const wrong = attempt("s1", "2026-10-01T10:00:00Z", "wrong");
    const good = attempt("s1", "2026-10-01T11:00:00Z");

    // Again from a new card: due the next day.
    expect(replay([wrong], NOW)?.nextReview).toBe("2026-10-02");
    // Good later that day replaces it: due 3 days on.
    expect(replay([wrong, good], NOW)).toEqual(replay([good], NOW));
    expect(replay([wrong, good], NOW)?.nextReview).toBe("2026-10-04");
  });

  test("a later day's first Attempt reviews the card and the rest of that day don't count", () => {
    const first = attempt("s1", "2026-10-01T10:00:00Z");
    const review = attempt("chat", "2026-10-04T09:00:00Z");
    // A mock Attempt the same day, in its own session.
    const mock = attempt("mock", "2026-10-04T15:00:00Z", "wrong");
    const now = "2026-10-05T12:00:00Z";

    expect(replay([first, review, mock], now)).toEqual({
      ...replay([first, review], now),
      // Learned stays: the mock's wrong answer doesn't undo it.
      learned: true,
    });
    expect(replay([first, review], now)?.nextReview).toBe("2026-10-18");
  });

  test("a mock and a Chat Attempt on the same day: the first reviews, whichever it is", () => {
    const first = attempt("chat-1", "2026-10-01T10:00:00Z");
    // A Mock exam's Attempt sits in the mock's session.
    const mock = attempt("mock-1", "2026-10-04T09:00:00Z", "wrong");
    const chat = attempt("chat-2", "2026-10-04T15:00:00Z");
    const now = "2026-10-05T12:00:00Z";

    const card = replayCard([first, chat, mock], 0.9)!;
    expect(card.lapses).toBe(1);
    expect(replay([first, mock, chat], now)?.nextReview).toBe(
      replay([first, mock], now)?.nextReview,
    );
  });

  test("a session across UTC midnight reviews on the new day", () => {
    const before = attempt("s1", "2026-10-01T23:50:00Z");
    const after = attempt("s1", "2026-10-02T00:10:00Z", "wrong");

    const card = replayCard([before, after], 0.9)!;
    expect(card.lapses).toBe(1);
    expect(card.reps).toBe(2);
  });

  test("solution_shown is Again even when full", () => {
    const shown = attempt(
      "s1",
      "2026-10-01T10:00:00Z",
      "full",
      "solution_shown",
    );
    expect(replay([shown], NOW)).toMatchObject({
      learned: false,
      nextReview: "2026-10-02",
    });
  });

  test.each<[Goal, string]>([
    ["pass", "2027-02-04"],
    ["good_grade", "2026-12-14"],
    [null, "2026-12-14"],
    ["master_everything", "2026-11-22"],
  ])("the goal %s sets the retention", (goal, nextReview) => {
    const attempts = [
      attempt("s1", "2026-10-01T10:00:00Z"),
      attempt("s2", "2026-10-04T10:00:00Z"),
      attempt("s3", "2026-10-18T10:00:00Z"),
    ];
    expect(replay(attempts, "2026-10-19T00:00:00Z", { goal })?.nextReview).toBe(
      nextReview,
    );
  });

  // Fixed sequences at retention 0.9: the FSRS-6 defaults.
  test.each([
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
    const card = replayCard(attempts, 0.9)!;
    expect(card.due.toISOString().slice(0, 10)).toBe(due);
    expect(card.stability).toBeCloseTo(stability, 4);
  });
});

describe("a KC's recall", () => {
  const taught = [attempt("s1", "2026-10-01T10:00:00Z")];

  test("is missing for a KC without Attempts", () => {
    expect(replay([], "2026-10-01T12:00:00Z")).toBeUndefined();
  });

  test("today's recall is at the end of the UTC day, so a wrong answer just now is not full recall", () => {
    const wrong = [attempt("s1", "2026-10-01T10:00:00Z", "wrong")];
    const recall = replay(wrong, "2026-10-01T10:00:01Z")!;
    expect(recall.recallToday).toBeLessThan(0.9);
    expect(recall).toMatchObject({ taught: true, learned: false, due: false });
  });

  test.each([
    ["a new KC", [] as ReplayAttempt[]],
    ["a long-learned KC", [attempt("s0", "2026-09-01T10:00:00Z")]],
  ])(
    "is under retention after %s is answered wrong late in the day",
    (_, earlier) => {
      const wrong = attempt("s1", "2026-10-01T23:00:00Z", "wrong");
      const recall = replay([...earlier, wrong], "2026-10-01T23:30:00Z")!;
      expect(recall.recallToday).toBeLessThan(desiredRetention(null));
    },
  );

  test("is due from its due day on", () => {
    expect(replay(taught, "2026-10-03T23:00:00Z")?.due).toBe(false);
    expect(replay(taught, "2026-10-04T00:00:00Z")?.due).toBe(true);
  });

  test("recall on the exam day falls below today's while the exam is ahead", () => {
    const now = "2026-10-02T12:00:00Z";
    const ahead = replay(taught, now, { examDate: "2026-10-20" })!;
    expect(ahead.recallOnExamDay).toBeLessThan(ahead.recallToday);
    // Without an exam date, or once it has passed, it is today's.
    for (const examDate of [null, "2026-10-02", "2026-09-30"]) {
      const recall = replay(taught, now, { examDate })!;
      expect(recall.recallOnExamDay).toBe(recall.recallToday);
    }
  });

  test("the exam date doesn't move the due day", () => {
    expect(
      replay(taught, "2026-10-02T12:00:00Z", { examDate: "2026-10-03" })
        ?.nextReview,
    ).toBe("2026-10-04");
  });
});

test("retrievability is ts-fsrs's at whole days and falls within a day", () => {
  const card = replayCard([attempt("s1", "2026-10-01T10:00:00Z")], 0.9)!;
  const tenDays = new Date("2026-10-11T10:00:00Z");
  expect(retrievability(card, tenDays)).toBeCloseTo(
    fsrs().retrievability(card, tenDays),
    6,
  );
  expect(retrievability(card, new Date("2026-10-01T20:00:00Z"))).toBeLessThan(
    1,
  );
});

test("desiredRetention follows the goal", () => {
  expect(desiredRetention("pass")).toBe(0.85);
  expect(desiredRetention("good_grade")).toBe(0.9);
  expect(desiredRetention("master_everything")).toBe(0.93);
  expect(desiredRetention(null)).toBe(0.9);
});

test("daysBetween counts whole UTC days", () => {
  expect(daysBetween("2026-10-01", "2026-10-22")).toBe(21);
  expect(daysBetween("2026-10-22", "2026-10-01")).toBe(-21);
});
