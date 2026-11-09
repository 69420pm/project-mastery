import { expect, test } from "vitest";
import { goalLabel } from "./tutor-context";

test.each([
  ["pass", "Pass"],
  ["good_grade", "A good grade"],
  ["master_everything", "Master everything"],
  [null, "Not answered"],
] as const)("goalLabel(%s) is %s", (goal, label) => {
  expect(goalLabel(goal)).toBe(label);
});
