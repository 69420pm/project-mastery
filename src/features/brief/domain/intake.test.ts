import { describe, expect, test } from "vitest";
import {
  isIntakeDone,
  suggestedReservation,
  type BriefFields,
  type ExamChapter,
} from "./intake";

const complete: BriefFields = {
  examDate: "2026-12-03",
  goal: "good_grade",
  openBook: false,
  formulaSheet: false,
  calculator: true,
  scopeConfirmed: true,
};

describe("isIntakeDone", () => {
  test("is done when every field is set and the scope is confirmed", () => {
    expect(isIntakeDone(complete)).toBe(true);
  });

  test("is not done without a Brief", () => {
    expect(isIntakeDone(null)).toBe(false);
  });

  test("is done on a confirmed scope with fields left unanswered", () => {
    expect(
      isIntakeDone({
        examDate: null,
        goal: null,
        openBook: null,
        formulaSheet: null,
        calculator: null,
        scopeConfirmed: true,
      }),
    ).toBe(true);
  });

  test("is not done until the scope is confirmed", () => {
    expect(isIntakeDone({ ...complete, scopeConfirmed: false })).toBe(false);
  });
});

const exam = (id: string): ExamChapter => ({ id, name: `Exam ${id}` });

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
