import { describe, expect, test } from "vitest";
import { adjustmentOf, adjustmentPlan } from "./adjustment";

describe("adjustmentOf", () => {
  const kcs = [
    { id: "k1", bigIdea: "b1" },
    { id: "k2", bigIdea: "b1" },
    { id: "p1", bigIdea: null },
  ];

  test("a KC's entry overrides its big idea's, and others keep 1", () => {
    const adjust = adjustmentOf(
      [
        { id: "b1", multiplier: 1.5, reason: "Stressed" },
        { id: "k2", multiplier: 0, reason: "Not examined" },
        { id: "nope", multiplier: 2, reason: "Unknown" },
      ],
      kcs,
    );
    expect(adjust("k1")).toEqual({ multiplier: 1.5, reasons: ["Stressed"] });
    expect(adjust("k2")).toEqual({ multiplier: 0, reasons: ["Not examined"] });
    expect(adjust("p1")).toEqual({ multiplier: 1, reasons: [] });
  });

  test("clamps multipliers to 0..2", () => {
    const adjust = adjustmentOf(
      [
        { id: "k1", multiplier: 5, reason: "a" },
        { id: "k2", multiplier: -1, reason: "b" },
      ],
      kcs,
    );
    expect(adjust("k1").multiplier).toBe(2);
    expect(adjust("k2").multiplier).toBe(0);
  });

  test.each([
    ["a non-finite multiplier keeps 1", Number.NaN, "a", 1, ["a"]],
    ["an empty reason gives no reason", 0.5, "", 0.5, []],
  ])("%s", (_, multiplier, reason, expected, reasons) => {
    const adjust = adjustmentOf([{ id: "k1", multiplier, reason }], kcs);
    expect(adjust("k1")).toEqual({ multiplier: expected, reasons });
  });

  test("an unknown KC keeps 1", () => {
    const adjust = adjustmentOf(
      [{ id: "b1", multiplier: 2, reason: "Stressed" }],
      kcs,
    );
    expect(adjust("unknown")).toEqual({ multiplier: 1, reasons: [] });
  });
});

describe("adjustmentPlan", () => {
  const base = {
    hasNotes: true,
    answeredAt: [],
    notesUpdatedAt: "2026-10-01T10:00:00Z",
    mapFinishedAt: "2026-10-01T09:00:00Z",
    adjustedAt: "2026-10-01T11:00:00Z",
  };

  test("skips without notes and answered Findings", () => {
    expect(adjustmentPlan({ ...base, hasNotes: false })).toBe("skip");
  });

  test("calls before the first adjustment", () => {
    expect(adjustmentPlan({ ...base, adjustedAt: null })).toBe("call");
  });

  test("reuses when nothing changed after the last adjustment", () => {
    expect(adjustmentPlan(base)).toBe("reuse");
  });

  test.each([
    ["the notes", { notesUpdatedAt: base.adjustedAt }],
    ["the map", { mapFinishedAt: base.adjustedAt }],
    ["an answer", { answeredAt: [base.adjustedAt] }],
  ])("reuses when %s changed exactly at the last adjustment", (_, at) => {
    expect(adjustmentPlan({ ...base, ...at })).toBe("reuse");
  });

  test("reuses without notes when only older answers exist", () => {
    expect(
      adjustmentPlan({
        ...base,
        hasNotes: false,
        notesUpdatedAt: null,
        mapFinishedAt: null,
        answeredAt: ["2026-10-01T08:00:00Z"],
      }),
    ).toBe("reuse");
  });

  test("calls when the notes, an answer or the map are newer", () => {
    const later = "2026-10-01T12:00:00Z";
    expect(adjustmentPlan({ ...base, notesUpdatedAt: later })).toBe("call");
    expect(adjustmentPlan({ ...base, mapFinishedAt: later })).toBe("call");
    expect(
      adjustmentPlan({ ...base, hasNotes: false, answeredAt: [later] }),
    ).toBe("call");
  });
});
