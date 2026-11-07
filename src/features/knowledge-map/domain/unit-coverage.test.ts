import { expect, test } from "vitest";
import { unitCoverage } from "./unit-coverage";

const chunks = [
  { id: "a", markdown: "x".repeat(30) },
  { id: "b", markdown: "x".repeat(70) },
];

test("is the share of the unit's characters in cited chunks", () => {
  expect(unitCoverage(chunks, ["a"])).toBeCloseTo(0.3);
  expect(unitCoverage(chunks, ["b", "a", "b"])).toBe(1);
  expect(unitCoverage(chunks, [])).toBe(0);
});

test("ignores cited chunks outside the unit, and counts an empty unit covered", () => {
  expect(unitCoverage(chunks, ["elsewhere"])).toBe(0);
  expect(unitCoverage([], [])).toBe(1);
});
