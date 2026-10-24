import { describe, expect, test } from "vitest";
import {
  activeSeconds,
  measurePace,
  paceEvidence,
  type TeachingSession,
} from "./pace";
import { DEFAULT_PACE } from "./plan";
import type { ReplayAttempt } from "./replay";

/** A Good `learn` attempt on `kcId` in session `sessionId`, `day` days in. */
const attempt = (
  kcId: string,
  sessionId: string,
  day: number,
  seconds: number | null = null,
): ReplayAttempt => ({
  kcId,
  sessionId,
  createdAt: new Date(Date.UTC(2026, 9, 1 + day)).toISOString(),
  kind: "learn",
  result: "full",
  help: "none",
  questionId: `${kcId}@${sessionId}`,
  confidence: null,
  seconds,
});

const minute = (n: number) =>
  new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString();

describe("activeSeconds", () => {
  test("sums the Student's gaps and the gap to the last reply, each capped at 5 minutes", () => {
    expect(
      activeSeconds([
        { role: "assistant", createdAt: minute(0) },
        { role: "user", createdAt: minute(1) },
        { role: "assistant", createdAt: minute(2) },
        { role: "user", createdAt: minute(4) },
        // 20 minutes away count as 5.
        { role: "user", createdAt: minute(24) },
        { role: "assistant", createdAt: minute(25) },
      ]),
    ).toBe((3 + 5 + 1) * 60);
  });

  test("is 0 without a Student message, and skips an unanswered last one", () => {
    expect(activeSeconds([{ role: "assistant", createdAt: minute(0) }])).toBe(
      0,
    );
    expect(
      activeSeconds([
        { role: "user", createdAt: minute(0) },
        { role: "assistant", createdAt: minute(1) },
        { role: "user", createdAt: minute(3) },
      ]),
    ).toBe(3 * 60);
  });
});

describe("paceEvidence", () => {
  test("finds the reviews and the ended sessions that first taught KCs", () => {
    const attempts = [
      attempt("a", "s1", 0),
      attempt("b", "s1", 0),
      attempt("a", "s2", 2, 40),
      // A second attempt in a session isn't a review.
      attempt("a", "s2", 2.1, 50),
      attempt("c", "s2", 2),
      // Its first session still runs, so it has no review yet.
      attempt("d", "open", 3),
      attempt("d", "s4", 4, 30),
    ];

    const { reviews, teaching } = paceEvidence(attempts, (id) => id !== "open");

    expect(reviews.map((r) => r.seconds)).toEqual([40]);
    expect(teaching).toEqual([
      {
        sessionId: "s1",
        kcsTaught: 2,
        reviews: 0,
        firstAt: attempts[0]!.createdAt,
      },
      {
        sessionId: "s2",
        kcsTaught: 1,
        reviews: 1,
        firstAt: attempts[4]!.createdAt,
      },
    ]);
  });
});

describe("measurePace", () => {
  const reviews = (seconds: number[]) =>
    seconds.map((s, i) => attempt("k", `r${i}`, i, s));
  const sessions = (count: number): TeachingSession[] =>
    Array.from({ length: count }, (_, i) => ({
      sessionId: `t${i}`,
      kcsTaught: 2,
      reviews: 1,
      firstAt: attempt("k", "t", i).createdAt,
    }));

  test("keeps the defaults under 5 reviews and 3 teaching sessions", () => {
    expect(
      measurePace({
        reviews: reviews([60, 60, 60, 60]),
        teaching: sessions(2),
        active: () => 600,
      }),
    ).toEqual(DEFAULT_PACE);
  });

  test("takes the median review time, capped at 5 minutes, from 5 reviews", () => {
    const pace = measurePace({
      reviews: [
        ...reviews([30, 60, 90, 900, 900]),
        // Unanswered: doesn't count.
        attempt("k", "u", 9, null),
      ],
      teaching: [],
      active: () => undefined,
    });
    expect(pace.minutesPerReview).toBe(1.5);
  });

  test("takes the median over the newest 5 teaching sessions with known active time", () => {
    const teaching = sessions(7);
    // Minutes per KC by session: (active − 1 review × 2) ÷ 2.
    const active = [100, 100, 10, 12, 22, 42, 62];
    const pace = measurePace({
      reviews: [],
      teaching,
      active: (id) => {
        const i = Number(id.slice(1));
        // A session whose Chat is gone doesn't count.
        return i === 6 ? undefined : active[i]! * 60;
      },
    });
    // Newest 5 known: 100, 10, 12, 22, 42 → 49, 4, 5, 10, 20.
    expect(pace).toEqual({ minutesPerKc: 10, minutesPerReview: 2 });
  });

  test("floors minutes per KC at 1", () => {
    expect(
      measurePace({
        reviews: [],
        teaching: sessions(3),
        active: () => 60,
      }).minutesPerKc,
    ).toBe(1);
  });
});
