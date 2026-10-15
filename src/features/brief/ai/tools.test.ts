import { describe, expect, test } from "vitest";
import { addNoteInputSchema, saveBriefInputSchema } from "./tools";

describe("saveBrief input", () => {
  test("takes any subset of the fields, null as not given", () => {
    expect(
      saveBriefInputSchema.parse({ examDate: "2026-12-03", goal: null }),
    ).toEqual({ examDate: "2026-12-03", goal: null });
    expect(saveBriefInputSchema.parse({})).toEqual({});
  });

  test("takes any Material id, which the handler checks", () => {
    expect(
      saveBriefInputSchema.parse({ excludedMaterialIds: ["old-exam"] }),
    ).toEqual({ excludedMaterialIds: ["old-exam"] });
  });

  test.each([
    { examDate: "3 December" },
    { goal: "excellent" },
    { hoursPerWeek: 0 },
    { hoursPerWeek: 81 },
    { questionStyle: "oral" },
    { openBook: "no" },
  ])("refuses %o", (input) => {
    expect(saveBriefInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("addNote input", () => {
  test("takes the statement as written, and refuses an empty one", () => {
    expect(addNoteInputSchema.parse({ text: " Heat exchangers! " })).toEqual({
      text: " Heat exchangers! ",
    });
    expect(addNoteInputSchema.safeParse({ text: "" }).success).toBe(false);
  });
});
