import { describe, expect, test, vi } from "vitest";
import { allRows } from "./all-rows";

/** A query over `total` numbered rows that records the ranges it is asked for. */
function pagedQuery(total: number) {
  const ranges: [number, number][] = [];
  const page = vi.fn(async (from: number, to: number) => {
    ranges.push([from, to]);
    const data = Array.from(
      { length: Math.max(0, Math.min(to, total - 1) - from + 1) },
      (_, i) => from + i,
    );
    return { data, error: null };
  });
  return { page, ranges };
}

describe("allRows", () => {
  test("reads every row, a thousand per request", async () => {
    const { page, ranges } = pagedQuery(2500);

    const rows = await allRows("Reading rows", page);

    expect(rows).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("asks once more after a full last page", async () => {
    const { page, ranges } = pagedQuery(2000);

    const rows = await allRows("Reading rows", page);

    expect(rows).toHaveLength(2000);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("treats null data as no rows", async () => {
    const rows = await allRows("Reading rows", async () => ({
      data: null,
      error: null,
    }));
    expect(rows).toEqual([]);
  });

  test("throws with the action in the message", async () => {
    await expect(
      allRows("Reading chunks", async () => ({
        data: null,
        error: { message: "timeout" },
      })),
    ).rejects.toThrow("Reading chunks failed: timeout");
  });
});
