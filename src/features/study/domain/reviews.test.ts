import { describe, expect, test } from "vitest";
import { replayKc, retrievability, type KcSchedule } from "./replay";
import { selectDueReviews } from "./reviews";

const kc = (id: string) => ({ id, name: `KC ${id}`, type: "concept" });
const NOW = new Date("2026-10-16T12:00:00Z");

/** A Good card from `reviewed`, due on `due`. */
const at = (due: string, reviewed = "2026-10-01T10:00:00Z") => {
  const { card } = replayKc(
    [
      {
        kcId: "k",
        sessionId: "s",
        createdAt: reviewed,
        kind: "learn",
        result: "full",
        help: "none",
        questionId: "q",
        confidence: null,
        seconds: null,
      },
    ],
    { ended: () => true, examDate: null, retention: 0.9 },
  )!;
  return { card: { ...card!, due: new Date(due) } };
};

describe("selectDueReviews", () => {
  test("lists due KCs by Priority × (1 − recall today), leaving out the rest", () => {
    const schedules = new Map<string, KcSchedule>([
      ["a", at("2026-10-16", "2026-10-15T10:00:00Z")], // 0.9 × little
      ["b", at("2026-10-13")], // 0.3 × much
      ["c", at("2026-10-17")], // not due yet
      ["d", at("2026-10-10")], // no Priority: last
      ["open", { card: null }], // first session still runs
    ]);

    const due = selectDueReviews(
      ["a", "b", "c", "d", "e", "open"].map(kc),
      schedules,
      { a: 0.9, b: 0.3, c: 1 },
      NOW,
    );

    expect(due.kcs.map(({ id }) => id)).toEqual(["b", "a", "d"]);
    expect(due.kcs[1]).toEqual({
      id: "a",
      name: "KC a",
      type: "concept",
      retrievability: retrievability(schedules.get("a")!.card!, NOW),
    });
    expect(due.more).toBe(0);
  });

  test("keeps at most 8 in map order on ties, and counts the rest", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `k${i}`);
    const schedules = new Map(ids.map((id) => [id, at("2026-10-15")]));

    const due = selectDueReviews(ids.map(kc), schedules, {}, NOW);

    expect(due.kcs).toHaveLength(8);
    expect(due.kcs[0]!.id).toBe("k0");
    expect(due.more).toBe(3);
  });

  test("lists the given KCs first, such as the session Topic's anchors", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `k${i}`);
    const schedules = new Map(ids.map((id) => [id, at("2026-10-15")]));

    const due = selectDueReviews(ids.map(kc), schedules, {}, NOW, [
      "k10",
      "k9",
    ]);

    expect(due.kcs.map(({ id }) => id).slice(0, 3)).toEqual([
      "k9",
      "k10",
      "k0",
    ]);
  });
});
