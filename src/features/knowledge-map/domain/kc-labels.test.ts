import { expect, test } from "vitest";
import { checkFlags } from "./kc-labels";

test("check flags match a KC by its exact name", () => {
  const report = {
    chaptersWithoutKcs: [],
    exercisesWithoutKcs: [],
    duplicates: [{ a: "Lift", b: "Thrust", similarity: 0.9 }],
    unitsBelowCoverage: [],
    unreadPages: [],
  };
  expect(checkFlags(report, "Thrust")).toEqual(["Possible duplicate of Lift"]);
  expect(checkFlags(report, "thrust")).toEqual([]);
  expect(checkFlags(null, "Thrust")).toEqual([]);
});
