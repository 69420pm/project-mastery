// @vitest-environment node
import { expect, test, vi } from "vitest";
import { loadFixture } from "./eval";
import { gradeEval, gradeGates, scoreGrade } from "./grade";

vi.mock("server-only", () => ({}));

const verdict = (results: Record<string, string>, help = "none") =>
  JSON.stringify({
    graded: true,
    results: Object.entries(results).map(([kcId, result]) => ({
      kcId,
      result,
    })),
    help,
    check: null,
  });

test("the fixture is a draft of about 40 labelled cases", async () => {
  const { items } = await loadFixture(gradeEval);
  expect(items.length).toBeGreaterThanOrEqual(35);
  expect(items.every((i) => i.expectedOutput.labelStatus === "draft")).toBe(
    true,
  );
  for (const { input, expectedOutput } of items) {
    expect(expectedOutput.kcs.map((k) => k.kcId)).toEqual(input.question.kcIds);
  }
});

test("a full verdict on an answer expected below full counts as false-full", () => {
  const expected = {
    labelStatus: "draft" as const,
    kcs: [
      { kcId: "A", result: "partial" as const },
      { kcId: "B", result: "full" as const },
    ],
    help: "some" as const,
  };
  expect(scoreGrade(verdict({ A: "full", B: "full" }), expected)).toEqual({
    graded: 1,
    kcs: 2,
    correct: 1,
    nonFull: 1,
    falseFull: 1,
    helpCorrect: 0,
  });
});

test("the gates need at most 5% false-full and at least 85% accuracy", () => {
  const item = (correct: number, falseFull: number) => ({
    evaluations: [
      { name: "kcs", value: 10 },
      { name: "correct", value: correct },
      { name: "non_full", value: 10 },
      { name: "false_full", value: falseFull },
    ],
  });
  expect(gradeGates([item(9, 0), item(9, 0)]).passed).toBe(true);
  expect(gradeGates([item(8, 0), item(8, 0)]).passed).toBe(false);
  expect(gradeGates([item(9, 2), item(9, 0)]).passed).toBe(false);
});
