import { createEmptyCard, State, type Card } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import { retrievability, type KcSchedule } from "./replay";
import { topicState } from "./topic-state";

const now = new Date("2026-10-10T12:00:00Z");
const options = {
  now,
  examDate: null as string | null,
  retention: 0.9,
};

/** A card last reviewed `daysAgo` days before now. */
const card = (stability: number, daysAgo: number, lapses = 0): KcSchedule => ({
  card: {
    ...createEmptyCard<Card>(now),
    state: State.Review,
    stability,
    lapses,
    last_review: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
  },
});
const strong = card(100, 1);
const weak = card(1, 10);

const stateOf = (
  schedules: Record<string, KcSchedule>,
  extra: Partial<typeof options> = {},
) =>
  topicState(["a", "b"], new Map(Object.entries(schedules)), {
    ...options,
    ...extra,
  });

describe("topic state", () => {
  test.each<[string, Record<string, KcSchedule>, string]>([
    ["no KC taught", {}, "new"],
    ["one KC taught", { a: strong }, "in_progress"],
    ["a KC in its first session", { a: { card: null } }, "in_progress"],
    [
      "every KC taught, one still in its first session",
      { a: strong, b: { card: null } },
      "learned",
    ],
    [
      "every KC taught, one under the retention",
      { a: strong, b: weak },
      "learned",
    ],
    [
      "every KC with a card at the retention",
      { a: strong, b: strong },
      "solid",
    ],
    // Needs work comes first, even on a Topic that would be solid or new.
    ["a card with 3 lapses", { a: strong, b: card(100, 1, 3) }, "needs_work"],
    [
      "a card with 3 lapses, the other untaught",
      { a: card(1, 10, 4) },
      "needs_work",
    ],
  ])("%s: %s", (_, schedules, state) => {
    expect(stateOf(schedules).state).toBe(state);
  });

  test("solid reads the recall on the exam date while it is ahead", () => {
    const fading = card(20, 1);
    expect(stateOf({ a: fading, b: fading }).state).toBe("solid");
    expect(
      stateOf({ a: fading, b: fading }, { examDate: "2026-11-30" }).state,
    ).toBe("learned");
  });

  test("a Topic without KCs is new", () => {
    expect(topicState([], new Map(), options)).toEqual({
      state: "new",
      recall: 0,
    });
  });
});

test("recall is today's mean, counting a KC without a card as 0", () => {
  const today = retrievability(strong.card!, now);

  expect(stateOf({ a: strong, b: strong }).recall).toBeCloseTo(today);
  expect(stateOf({ a: strong }).recall).toBeCloseTo(today / 2);
  expect(stateOf({ a: strong, b: { card: null } }).recall).toBeCloseTo(
    today / 2,
  );
  // The exam date doesn't move today's recall.
  expect(stateOf({ a: strong }, { examDate: "2026-11-30" }).recall).toBeCloseTo(
    today / 2,
  );
});
