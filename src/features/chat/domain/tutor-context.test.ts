import { describe, expect, test } from "vitest";
import { overdueText, pacingText } from "./tutor-context";

describe("pacingText", () => {
  test("shows the share with the left-out count", () => {
    expect(pacingText({ share: 80, leftOutCount: 4 })).toBe(
      "80% fit, 4 left out",
    );
  });

  test("says there is no pacing without one", () => {
    expect(pacingText({ share: null, leftOutCount: null })).toBe("No pacing");
  });
});

test.each([
  [0, "due today"],
  [1, "1 day overdue"],
  [3, "3 days overdue"],
])("overdueText(%i) is %s", (days, text) => {
  expect(overdueText(days)).toBe(text);
});
