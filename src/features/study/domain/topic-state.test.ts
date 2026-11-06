import { describe, expect, test } from "vitest";
import { UNTAUGHT, type KcRecall } from "./replay";
import { topicState } from "./topic-state";

const kc = (recallToday: number, recallOnExamDay = recallToday): KcRecall => ({
  ...UNTAUGHT,
  taught: true,
  recallToday,
  recallOnExamDay,
});
const strong = kc(0.98);
const weak = kc(0.5);

const stateOf = (recall: Record<string, KcRecall>) =>
  topicState(["a", "b"], new Map(Object.entries(recall)), 0.9);

describe("topic state", () => {
  test.each<[string, Record<string, KcRecall>, string]>([
    ["no KC taught", {}, "new"],
    ["one KC taught", { a: strong }, "in_progress"],
    [
      "every KC taught, one under the retention",
      { a: strong, b: weak },
      "learned",
    ],
    ["every KC at the retention", { a: strong, b: strong }, "solid"],
    [
      "every KC at it today but not on the exam day",
      { a: strong, b: kc(0.95, 0.6) },
      "learned",
    ],
  ])("%s: %s", (_, recall, state) => {
    expect(stateOf(recall).state).toBe(state);
  });

  test("a Topic without KCs is new", () => {
    expect(topicState([], new Map(), 0.9)).toEqual({ state: "new", recall: 0 });
  });

  test("recall is today's mean, counting an untaught KC as 0", () => {
    expect(stateOf({ a: strong, b: weak }).recall).toBeCloseTo(0.74);
    expect(stateOf({ a: strong }).recall).toBeCloseTo(0.49);
  });
});
