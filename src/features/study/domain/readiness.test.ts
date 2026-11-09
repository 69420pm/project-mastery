import { describe, expect, test } from "vitest";
import { readiness } from "./readiness";
import { UNTAUGHT, type KcRecall } from "./replay";

const recalled = (recallOnExamDay: number): KcRecall => ({
  ...UNTAUGHT,
  taught: true,
  recallToday: 1,
  recallOnExamDay,
});
const kc = (id: string) => ({ id });

describe("readiness", () => {
  test("weights recall on the exam day by Priority", () => {
    const value = readiness(
      [kc("a"), kc("b")],
      { a: 3, b: 1 },
      new Map([
        ["a", recalled(0.8)],
        ["b", recalled(0.4)],
      ]),
    );
    expect(value).toBeCloseTo(0.7);
  });

  test("an untaught KC counts 0", () => {
    expect(readiness([kc("a")], { a: 1 }, new Map())).toBe(0);
  });

  test("a KC without a Priority weighs nothing", () => {
    expect(
      readiness([kc("a"), kc("b")], { a: 1 }, new Map([["a", recalled(1)]])),
    ).toBeCloseTo(1);
  });

  test("is null when nothing weighs", () => {
    expect(readiness([kc("a")], {}, new Map())).toBeNull();
    expect(readiness([], { a: 1 }, new Map())).toBeNull();
  });
});
