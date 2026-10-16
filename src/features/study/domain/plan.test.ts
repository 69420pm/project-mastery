import { describe, expect, test } from "vitest";
import { planStudy, type PlanInput } from "./plan";

const kc = (id: string, bigIdea: string | null = "B") => ({
  id,
  name: `KC ${id}`,
  bigIdea,
});

const TODAY = "2026-10-01";

const plan = (
  overrides: Partial<Omit<PlanInput, "exam">> & {
    exam?: Partial<PlanInput["exam"]>;
  } = {},
) =>
  planStudy({
    kcs: [kc("a"), kc("b"), kc("c"), kc("d")],
    priorities: { a: 0.9, b: 0.5, c: 0.5, d: 0.1 },
    taught: new Set(),
    today: TODAY,
    ...overrides,
    // 21 days left: 14 days before the final week.
    exam: { examDate: "2026-10-22", hoursPerWeek: 1, ...overrides.exam },
  });

describe("planStudy", () => {
  test.each([
    ["the exam day", "2026-10-01", "final_week"],
    ["exactly 7 days", "2026-10-08", "final_week"],
    ["8 days", "2026-10-09", "build"],
  ])("with %s left the Phase is %s", (_, examDate, phase) => {
    expect(plan({ exam: { examDate } })).toMatchObject({ phase });
  });

  test("has no pacing in the final week", () => {
    expect(plan({ exam: { examDate: TODAY } }).pacing).toBeNull();
  });

  test("has no Phase without an exam date or once it has passed", () => {
    const none = { phase: null, pacing: null };
    expect(plan({ exam: { examDate: null } })).toEqual(none);
    expect(plan({ exam: { examDate: "2026-09-30" } })).toEqual(none);
  });

  test("deepens once every relevant KC is taught, all of them fitting", () => {
    expect(plan({ taught: new Set(["a", "b", "c", "d"]) })).toEqual({
      phase: "deepen",
      pacing: { share: 100, leftOut: [] },
    });
  });

  test("has a Phase but no pacing without weekly hours", () => {
    expect(plan({ exam: { hoursPerWeek: null } })).toEqual({
      phase: "build",
      pacing: null,
    });
  });

  test("fits 30 minutes per KC, rounding capacity down, and breaks Priority ties by name", () => {
    // 1.4 h/week for 2 weeks: 2.8 h, 5.6 KCs, so 5 fit.
    const many = ["e", "f", "g", "h", "i", "j"].map((id) => kc(id));
    const result = plan({
      kcs: many,
      priorities: { e: 0.2, f: 0.5, g: 0.5, h: 0.9, i: 0.1, j: 0.5 },
      exam: { hoursPerWeek: 1.4 },
    });
    expect(result.pacing).toEqual({ share: 83, leftOut: ["i"] });

    // 0.5 h/week for 2 weeks fits 2: h, then f of the 0.5 ties by name.
    expect(
      plan({
        kcs: many,
        priorities: { e: 0.2, f: 0.5, g: 0.5, h: 0.9, i: 0.1, j: 0.5 },
        exam: { hoursPerWeek: 0.5 },
      }).pacing?.leftOut,
    ).toEqual(["g", "j", "e", "i"]);
  });

  test("counts taught KCs as fitting and leaves out prior knowledge and Priority 0", () => {
    // Relevant: a, b, d; a taught; capacity 1 fits b; d is left out.
    const result = plan({
      kcs: [kc("a"), kc("b"), kc("c"), kc("d"), kc("p", null)],
      priorities: { a: 0.9, b: 0.5, c: 0, d: 0.1, p: 0.8 },
      taught: new Set(["a"]),
      exam: { hoursPerWeek: 0.25 },
    });
    expect(result).toEqual({
      phase: "build",
      pacing: { share: 66, leftOut: ["d"] },
    });
  });
});
