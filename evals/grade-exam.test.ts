// @vitest-environment node
import { expect, test, vi } from "vitest";
import { loadFixture } from "./eval";
import { gradeExamEval, gradeExamGates, scoreGradeExam } from "./grade-exam";

vi.mock("server-only", () => ({}));

test("the fixture is about 25 draft subtasks in 3 mocks", async () => {
  const { items } = await loadFixture(gradeExamEval);
  expect(items.length).toBeGreaterThanOrEqual(24);
  expect(new Set(items.map((i) => i.input.mock)).size).toBe(3);
  expect(items.every((i) => i.expectedOutput.labelStatus === "draft")).toBe(
    true,
  );
  for (const { input, expectedOutput } of items) {
    expect(expectedOutput.awarded).toBeLessThanOrEqual(input.points);
    // A wrong final value is only caught against a key, and is capped.
    if (expectedOutput.wrongFinal) {
      expect(input.finalAnswers).not.toBeNull();
      expect(expectedOutput.awarded).toBeLessThanOrEqual(input.points - 1);
    }
  }
});

test("a subtask's error is its share of the points, and full marks on a wrong value count", () => {
  const expected = {
    labelStatus: "draft" as const,
    awarded: 2,
    wrongFinal: true,
  };
  expect(
    scoreGradeExam(
      JSON.stringify({ awarded: 3, points: 4, check: null }),
      expected,
    ),
  ).toEqual({ errorShare: 0.25, wrongFinal: 1, falseFull: 0 });
  expect(
    scoreGradeExam(
      JSON.stringify({ awarded: 4, points: 4, check: null }),
      expected,
    ).falseFull,
  ).toBe(1);
});

test("the gates are reported and never block the run", () => {
  const item = (errorShare: number, falseFull: number) => ({
    evaluations: [
      { name: "error_share", value: errorShare },
      { name: "wrong_final", value: 1 },
      { name: "false_full", value: falseFull },
    ],
  });
  const good = gradeExamGates([item(0.05, 0), item(0.1, 0)]);
  expect(good.passed).toBe(true);
  expect(good.summary).toContain("7.5%");
  expect(good.summary).not.toContain("not met");
  const bad = gradeExamGates([item(0.3, 1)]);
  expect(bad.passed).toBe(true);
  expect(bad.summary).toContain("not met");
});
