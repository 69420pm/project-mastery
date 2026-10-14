import { describe, expect, test } from "vitest";
import {
  appendNote,
  isIntakeDone,
  MAX_BRIEF_NOTES_LENGTH,
  type BriefFields,
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

describe("appendNote", () => {
  test("starts the notes, then appends after a blank line", () => {
    expect(appendNote(null, "First.")).toBe("First.");
    expect(appendNote("First.", "Second.")).toBe("First.\n\nSecond.");
  });

  test("refuses notes that would grow past the limit", () => {
    const full = "x".repeat(MAX_BRIEF_NOTES_LENGTH - 2);
    expect(appendNote(full, "y")).toBeNull();
  });
});
