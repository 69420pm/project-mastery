import { describe, expect, test, vi } from "vitest";
import type { TutorContext } from "@/features/study";
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

describe("pacingText", () => {
  const withFit = (fitLine: string | null) =>
    ({ todayPlan: { next: null, hint: null, fitLine } }) as TutorContext;

  test("shows the fit line", () => {
    const line = "Build phase. At your pace, 9 of 12 Topics fit.";
    expect(pacingText(withFit(line))).toBe(line);
  });

  test("says there is no pacing without one, or in a context stored before #177", () => {
    expect(pacingText(withFit(null))).toBe("No pacing");
    expect(pacingText({} as TutorContext)).toBe("No pacing");
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
