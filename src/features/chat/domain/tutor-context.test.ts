import { describe, expect, test, vi } from "vitest";
import {
  dueReviewText,
  goalLabel,
  pacingText,
  phaseLabel,
} from "./tutor-context";

// The study feature's index also exports its Memory card's server action.
vi.mock("server-only", () => ({}));

test.each([
  ["build", "Build"],
  ["deepen", "Deepen"],
  ["final_week", "Final week"],
  [null, "None"],
] as const)("phaseLabel(%s) is %s", (phase, label) => {
  expect(phaseLabel(phase)).toBe(label);
});

test.each([
  ["pass", "Pass"],
  ["good_grade", "A good grade"],
  ["master_everything", "Master everything"],
  [null, "Not answered"],
] as const)("goalLabel(%s) is %s", (goal, label) => {
  expect(goalLabel(goal)).toBe(label);
});

test.each([
  [80, null],
  [null, 4],
])(
  "pacingText says no pacing when share is %s and left out is %s",
  (share, leftOutCount) => {
    expect(pacingText({ share, leftOutCount })).toBe("No pacing");
  },
);

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

describe("dueReviewText", () => {
  test("shows today's recall", () => {
    expect(dueReviewText({ retrievability: 0.836 })).toBe(
      "due · Recall today 84%",
    );
  });

  test("shows only due for a context stored before FSRS", () => {
    expect(dueReviewText({})).toBe("due");
  });
});
