import { createEmptyCard, State, type Card } from "ts-fsrs";
import { describe, expect, test } from "vitest";
import { readiness } from "./readiness";
import type { KcSchedule } from "./replay";

const now = new Date("2026-10-10T12:00:00Z");
const options = { now, examDate: null as string | null };

/** A card reviewed just now: recall 1 today. */
const fresh: KcSchedule = {
  card: {
    ...createEmptyCard<Card>(now),
    state: State.Review,
    stability: 100,
    last_review: now,
  },
};
const kc = (id: string, prior = false) => ({ id, prior });

describe("readiness", () => {
  test("weights recall by Priority", () => {
    const value = readiness(
      [kc("a"), kc("b")],
      { a: 3, b: 1 },
      new Map([["a", fresh]]),
      options,
    );
    expect(value).toBeCloseTo(0.75);
  });

  test("an untaught KC counts 0 and a prior-knowledge KC 0.9", () => {
    expect(readiness([kc("a")], { a: 1 }, new Map(), options)).toBe(0);
    expect(readiness([kc("p", true)], { p: 1 }, new Map(), options)).toBe(0.9);
  });

  test("a KC with a card in its first session counts 0", () => {
    const schedules = new Map([["a", { card: null }]]);
    expect(readiness([kc("a")], { a: 1 }, schedules, options)).toBe(0);
  });

  test("a KC without a Priority weighs nothing", () => {
    const schedules = new Map([["a", fresh]]);
    expect(
      readiness([kc("a"), kc("b")], { a: 1 }, schedules, options),
    ).toBeCloseTo(1);
  });

  test("is null when nothing weighs", () => {
    expect(readiness([kc("a")], {}, new Map(), options)).toBeNull();
    expect(readiness([], { a: 1 }, new Map(), options)).toBeNull();
  });

  test("projects recall to the exam date", () => {
    const schedules = new Map([["a", fresh]]);
    const today = readiness([kc("a")], { a: 1 }, schedules, options)!;
    const onTheDay = readiness([kc("a")], { a: 1 }, schedules, {
      now,
      examDate: "2027-10-10",
    })!;
    expect(onTheDay).toBeLessThan(today);
  });
});
