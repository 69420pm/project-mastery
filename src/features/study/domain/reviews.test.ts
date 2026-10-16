import { describe, expect, test } from "vitest";
import { selectDueReviews } from "./reviews";

const kc = (id: string) => ({ id, name: `KC ${id}`, type: "concept" });
const at = (nextReview: string, level = 1) => ({ level, nextReview });
const TODAY = "2026-10-16";

describe("selectDueReviews", () => {
  test("lists due KCs by Priority × (days overdue + 1), leaving out the rest", () => {
    const ladder = new Map([
      ["a", at("2026-10-16", 2)], // 0.9 × 1
      ["b", at("2026-10-13")], // 0.3 × 4
      ["c", at("2026-10-17")], // not due yet
      ["d", at("2026-10-10")], // no Priority: last
    ]);

    const due = selectDueReviews(
      ["a", "b", "c", "d", "e"].map(kc),
      ladder,
      { a: 0.9, b: 0.3, c: 1 },
      TODAY,
    );

    expect(due.kcs.map(({ id, daysOverdue }) => [id, daysOverdue])).toEqual([
      ["b", 3],
      ["a", 0],
      ["d", 6],
    ]);
    expect(due.kcs[1]).toMatchObject({ name: "KC a", level: 2 });
    expect(due.more).toBe(0);
  });

  test("keeps at most 8 and counts the rest", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `k${i}`);
    const ladder = new Map(ids.map((id) => [id, at("2026-10-15")]));

    const due = selectDueReviews(ids.map(kc), ladder, {}, TODAY);

    expect(due.kcs).toHaveLength(8);
    expect(due.kcs[0]!.id).toBe("k0");
    expect(due.more).toBe(3);
  });
});
