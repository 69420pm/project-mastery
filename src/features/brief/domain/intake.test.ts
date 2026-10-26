import { describe, expect, test } from "vitest";
import {
  asksFindings,
  isIntakeDone,
  suggestedReservation,
  type BriefFields,
  type ExamMaterial,
} from "./intake";

const complete: BriefFields = {
  examDate: "2026-12-03",
  goal: "good_grade",
  hoursPerWeek: 6,
  questionStyle: "written",
  openBook: false,
  formulaSheet: false,
  calculator: true,
  scopeConfirmed: true,
};

describe("isIntakeDone", () => {
  test("is done when every field is set and the scope is confirmed", () => {
    expect(isIntakeDone(complete)).toBe(true);
  });

  test("counts false answers as answered", () => {
    expect(isIntakeDone({ ...complete, openBook: false })).toBe(true);
  });

  test("is not done without a Brief", () => {
    expect(isIntakeDone(null)).toBe(false);
  });

  test.each([
    "examDate",
    "goal",
    "hoursPerWeek",
    "questionStyle",
    "calculator",
  ])("is not done while %s is unanswered", (field) => {
    expect(isIntakeDone({ ...complete, [field]: null })).toBe(false);
  });

  test("is not done until the scope is confirmed", () => {
    expect(isIntakeDone({ ...complete, scopeConfirmed: false })).toBe(false);
  });
});

const exam = (id: string, year: number | null): ExamMaterial => ({
  id,
  name: `Exam ${id}`,
  year,
  totalPoints: 60,
});

describe("suggestedReservation", () => {
  test("suggests none with only one old exam", () => {
    expect(suggestedReservation([])).toBeNull();
    expect(suggestedReservation([exam("a", 2024)])).toBeNull();
  });

  test("suggests the most recent by year, a later upload breaking ties, a missing year last", () => {
    expect(
      suggestedReservation([exam("a", 2024), exam("b", 2022), exam("c", null)])
        ?.id,
    ).toBe("a");
    expect(suggestedReservation([exam("a", 2024), exam("b", 2024)])?.id).toBe(
      "b",
    );
  });
});

describe("asksFindings", () => {
  const unanswered = { answered: false, materialId: null };

  test("waits for the reservation question while the Course has an old exam", () => {
    expect(asksFindings(complete, [exam("a", 2024)], unanswered)).toBe(false);
    expect(
      asksFindings(complete, [exam("a", 2024)], {
        answered: true,
        materialId: null,
      }),
    ).toBe(true);
  });

  test("asks once intake is done when the Course has no old exam", () => {
    expect(asksFindings(complete, [], unanswered)).toBe(true);
    expect(asksFindings({ ...complete, goal: null }, [], unanswered)).toBe(
      false,
    );
  });
});
