import { describe, expect, test } from "vitest";
import {
  awardedPoints,
  byPointsLost,
  checkedResult,
  mockScore,
} from "./mock-grading";

const step = (points: number) => ({ points, reason: "Step." });

describe("awardedPoints", () => {
  test("sums the steps in halves, within 0 and the item's points", () => {
    expect(awardedPoints([step(2), step(1.5)], 6, "match")).toBe(3.5);
    expect(awardedPoints([step(1.3)], 6, null)).toBe(1.5);
    expect(awardedPoints([step(5), step(4)], 6, null)).toBe(6);
    expect(awardedPoints([step(-1)], 6, null)).toBe(0);
  });

  test("caps a mismatched final value at the points − 1", () => {
    expect(awardedPoints([step(6)], 6, "mismatch")).toBe(5);
    expect(awardedPoints([step(3)], 6, "mismatch")).toBe(3);
    expect(awardedPoints([step(1)], 1, "mismatch")).toBe(0);
  });
});

test("a mismatch turns full into partial and leaves the rest", () => {
  expect(checkedResult("full", "mismatch")).toBe("partial");
  expect(checkedResult("wrong", "mismatch")).toBe("wrong");
  expect(checkedResult("full", "match")).toBe("full");
});

describe("mockScore", () => {
  test("leaves a failed item out of the score and the Brier score", () => {
    expect(
      mockScore([
        { points: 10, awarded: 5, predictedSuccess: 0.7 },
        { points: 4, awarded: 4, predictedSuccess: 0.6 },
        { points: 8, awarded: null, predictedSuccess: 0.1 },
      ]),
    ).toEqual({
      score: 9,
      // ((0.7 − 0.5)² + (0.6 − 1)²) / 2
      brier: expect.closeTo(0.1, 10),
    });
  });

  test("has no Brier score without a graded item", () => {
    expect(
      mockScore([{ points: 8, awarded: null, predictedSuccess: 0.5 }]),
    ).toEqual({ score: 0, brier: null });
  });
});

test("byPointsLost puts the biggest loss first, exam order on ties, and ungraded items last", () => {
  const item = (position: number, points: number, awarded: number | null) => ({
    position,
    points,
    awarded,
  });
  expect(
    byPointsLost([
      item(0, 4, 4),
      item(1, 6, null),
      item(2, 6, 2),
      item(3, 10, 8),
      item(4, 3, 0),
    ]).map(({ position }) => position),
  ).toEqual([2, 4, 3, 0, 1]);
});
