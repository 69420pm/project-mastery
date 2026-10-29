import { describe, expect, test } from "vitest";
import {
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

const exam = (id: string): ExamMaterial => ({ id, name: `Exam ${id}` });

describe("suggestedReservation", () => {
  test("suggests none with only one old exam", () => {
    expect(suggestedReservation([])).toBeNull();
    expect(suggestedReservation([exam("a")])).toBeNull();
  });

  test("suggests the latest upload", () => {
    expect(suggestedReservation([exam("a"), exam("b"), exam("c")])?.id).toBe(
      "c",
    );
  });
});
