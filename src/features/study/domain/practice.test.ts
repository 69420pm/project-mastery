import { createEmptyCard, State, type Card } from "ts-fsrs";
import { expect, test } from "vitest";
import { selectPracticeKcs } from "./practice";
import type { KcSchedule } from "./replay";

const NOW = new Date("2026-10-16T12:00:00Z");

/** A card last reviewed on 2026-10-01 with the given stability in days. */
const card = (stability: number): KcSchedule => ({
  card: {
    ...createEmptyCard<Card>(NOW),
    state: State.Review,
    stability,
    due: new Date("2026-12-01T12:00:00Z"),
    last_review: new Date("2026-10-01T12:00:00Z"),
  },
});

const kcs = (...ids: string[]) =>
  ids.map((id) => ({ id, name: `KC ${id}`, type: "procedure" }));

const select = (input: Partial<Parameters<typeof selectPracticeKcs>[0]> = {}) =>
  selectPracticeKcs({
    kcs: kcs("a", "b", "c"),
    topics: [
      { id: "t1", kcs: ["a", "b", "c"], status: "in_plan", state: "learned" },
    ],
    schedules: new Map([
      ["a", card(100)],
      ["b", card(1)],
      ["c", card(10)],
    ]),
    priorities: { a: 1, b: 1, c: 1 },
    now: NOW,
    ...input,
  }).map(({ id }) => id);

test("ranks the taught KCs by Priority × (1 − recall today), ties in map order", () => {
  expect(select()).toEqual(["b", "c", "a"]);
  expect(select({ priorities: { a: 50, b: 1 } })).toEqual(["a", "b", "c"]);
  expect(
    select({
      schedules: new Map([
        ["a", card(5)],
        ["b", card(5)],
      ]),
    }),
  ).toEqual(["a", "b"]);
});

test("takes only the in-plan Topics that are learned, solid or need work", () => {
  const topics = (
    ["new", "in_progress", "learned", "solid", "needs_work"] as const
  ).map((state, i) => ({
    id: `t${i}`,
    kcs: [`k${i}`],
    status: "in_plan" as const,
    state,
  }));
  const ids = topics.map(({ kcs: [id] }) => id!);
  const schedules = new Map(ids.map((id) => [id, card(5)]));
  expect(select({ kcs: kcs(...ids), topics, schedules })).toEqual([
    "k2",
    "k3",
    "k4",
  ]);
  expect(
    select({
      topics: [
        { id: "t", kcs: ["a"], status: "if_time_allows", state: "solid" },
      ],
    }),
  ).toEqual([]);
});

test("keeps the top 8 and names each KC's first practised Topic", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `k${i}`);
  const result = selectPracticeKcs({
    kcs: kcs(...ids),
    topics: [
      { id: "t0", kcs: ["k0"], status: "in_plan", state: "new" },
      { id: "t1", kcs: ids, status: "in_plan", state: "solid" },
    ],
    schedules: new Map(ids.map((id) => [id, card(5)])),
    priorities: {},
    now: NOW,
  });
  expect(result).toHaveLength(8);
  expect(result[0]).toEqual({
    id: "k0",
    name: "KC k0",
    type: "procedure",
    topicId: "t1",
  });
});
