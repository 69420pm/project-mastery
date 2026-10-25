import { describe, expect, test } from "vitest";
import { replayKc, type KcSchedule } from "./replay";
import { planReviewQueue } from "./review-queue";

const STARTED = new Date("2026-10-16T12:00:00Z");

/** A Good card from 2026-10-01, due on `due`. */
const card = (due = "2026-10-15"): KcSchedule => {
  const { card } = replayKc(
    [
      {
        kcId: "k",
        sessionId: "s",
        createdAt: "2026-10-01T10:00:00Z",
        kind: "learn",
        result: "full",
        help: "none",
        questionId: "q",
        confidence: null,
        seconds: null,
      },
    ],
    { ended: () => true, examDate: null, retention: 0.9 },
  )!;
  return { card: { ...card!, due: new Date(due) } };
};

/** A queue over due KCs `ids` in rank order, with their Topics. */
const plan = (
  topics: Record<string, string>,
  options: Partial<Parameters<typeof planReviewQueue>[0]> = {},
) => {
  const ids = Object.keys(topics);
  return planReviewQueue({
    kcs: ids.map((id) => ({ id, name: `KC ${id}`, type: "concept" })),
    schedules: new Map(ids.map((id) => [id, card()])),
    // Falling Priorities keep the KCs in the order given.
    priorities: Object.fromEntries(ids.map((id, i) => [id, 1 - i / 100])),
    startedAt: STARTED,
    minutesPerReview: 1,
    topicOf: new Map(Object.entries(topics)),
    links: [],
    questions: [],
    attempts: [],
    ...options,
  });
};

const ids = (queue: ReturnType<typeof planReviewQueue>) =>
  queue.map((group) => group.kcs.map(({ id }) => id));

describe("planReviewQueue", () => {
  test("groups by Topic up to 3 KCs, and interleaves the Topics", () => {
    const queue = plan({ a: "T1", b: "T1", c: "T1", d: "T1", e: "T2" });

    expect(ids(queue)).toEqual([["a", "b", "c"], ["e"], ["d"]]);
    expect(queue.map(({ topicId }) => topicId)).toEqual(["T1", "T2", "T1"]);
  });

  test("joins a KC of another Topic by a link to one in the group", () => {
    const queue = plan(
      { a: "T1", b: "T2", c: "T3", d: "T4" },
      { links: [{ from: "c", to: "a" }] },
    );

    expect(ids(queue)).toEqual([["a", "c"], ["b"], ["d"]]);
  });

  test("leaves out KCs not due at the start, and ranks by urgency", () => {
    const queue = plan(
      { a: "T1", b: "T2", c: "T3" },
      {
        schedules: new Map([
          ["a", card()],
          ["b", card("2026-10-17")],
          ["c", card()],
        ]),
        priorities: { a: 0.1, c: 0.9 },
      },
    );

    expect(ids(queue)).toEqual([["c"], ["a"]]);
  });

  test("cuts the queue to 20 minutes, keeping at least one KC", () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`k${i}`, `T${i}`]),
    );

    expect(
      plan(many, { minutesPerReview: 2 }).flatMap((g) => g.kcs),
    ).toHaveLength(10);
    expect(plan(many, { minutesPerReview: 30 })).toHaveLength(1);
  });

  test("a group is open, retry until a later question, then done", () => {
    const attempt = (kcId: string, result: "full" | "wrong", at: string) => ({
      kcId,
      result,
      createdAt: `2026-10-16T12:${at}:00Z`,
    });
    const first = [attempt("a", "full", "05"), attempt("b", "wrong", "05")];
    const statuses = (options: Parameters<typeof plan>[1]) =>
      plan({ a: "T1", b: "T1", c: "T2" }, options).map(
        ({ status, retryKcIds }) => [status, retryKcIds],
      );

    expect(statuses({ attempts: first })).toEqual([
      ["retry", ["b"]],
      ["open", []],
    ]);
    expect(
      statuses({
        attempts: [...first, attempt("b", "full", "20")],
        questions: [{ kcIds: ["b"], askedAt: "2026-10-16T12:15:00Z" }],
      }),
    ).toEqual([
      ["done", []],
      ["open", []],
    ]);
  });
});
