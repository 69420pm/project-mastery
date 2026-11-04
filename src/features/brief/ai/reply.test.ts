import { describe, expect, test, vi } from "vitest";
import type { BriefContext } from "@/features/brief/domain/intake";

vi.mock("@/lib/ai/models", () => ({ aiTask: () => ({}) }));

const { briefReplySettings } = await import("./reply");

const context: BriefContext = {
  fields: {
    examDate: null,
    goal: null,
    openBook: null,
    formulaSheet: null,
    calculator: null,
    scopeConfirmed: false,
  },
  notes: null,
  materials: [],
  exams: [],
  reservedExam: { answered: false, chapterId: null },
  language: { name: "English", chosen: false },
  topics: [],
  examScopes: [],
  adminTexts: [],
};

describe("briefReplySettings", () => {
  test("asks in batches, then closes with a link to the Course map", () => {
    const { instructions } = briefReplySettings(
      context,
      "/courses/course-1/map",
    );
    const order = ["1. the exam date", "2. the format", "3. the scope"]
      .concat(["4. the reserved exam", "5. one open question"])
      .map((batch) => instructions.indexOf(batch));
    expect(order.every((at, i) => at >= 0 && at > (order[i - 1] ?? -1))).toBe(
      true,
    );
    expect(instructions).toContain("[Course map](/courses/course-1/map)");
  });
});
