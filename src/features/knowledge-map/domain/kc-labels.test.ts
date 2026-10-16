import { expect, test } from "vitest";
import { checkFlags } from "./kc-labels";

test("check flags match a KC by its exact name", () => {
  const report = {
    uncoveredChunks: [],
    ungroundedKcs: ["Thrust"],
    orphanKcs: ["Thrust", "Drag"],
    droppedCycleEdges: [],
    unmappedExercises: [],
    untestedKcs: [],
    duplicates: [{ a: "Lift", b: "Thrust", similarity: 0.9 }],
  };
  expect(checkFlags(report, "Thrust")).toEqual([
    "No source",
    "No links",
    "Possible duplicate of Lift",
  ]);
  expect(checkFlags(report, "thrust")).toEqual([]);
  expect(checkFlags(null, "Thrust")).toEqual([]);
});
