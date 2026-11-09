import { describe, expect, test } from "vitest";
import {
  pageBatches,
  uncoveredPages,
  unitsOnPages,
  type BatchUnit,
} from "@/features/ingestion/domain/page-batches";

const unit = (overrides: Partial<BatchUnit>): BatchUnit => ({
  markdown: "Text.",
  label: "content",
  pageFrom: 1,
  pageTo: 1,
  style: null,
  continuesFromPreviousBatch: false,
  continuesOnNextBatch: false,
  ...overrides,
});

test("pageBatches cuts the pages to read into runs of at most 5", () => {
  expect(pageBatches([1, 2, 4, 5, 6, 7, 9])).toEqual([
    [1, 2, 4, 5, 6],
    [7, 9],
  ]);
  expect(pageBatches([])).toEqual([]);
});

test("uncoveredPages gives the pages no unit spans", () => {
  expect(
    uncoveredPages(
      [unit({ pageFrom: 3, pageTo: 5 }), unit({ pageFrom: 8, pageTo: 8 })],
      [10, 3, 4, 5, 6, 7, 8],
    ),
  ).toEqual([6, 7, 10]);
  expect(uncoveredPages([], [2, 1])).toEqual([1, 2]);
});

describe("unitsOnPages", () => {
  test("lists each unit on the page it starts, and every batch page", () => {
    const placed = unitsOnPages(
      [
        unit({ markdown: "a", pageFrom: 3, pageTo: 5 }),
        unit({ markdown: "b", pageFrom: 5, pageTo: 5 }),
      ],
      [3, 5, 6],
    );

    expect(
      [...placed].map(([page, units]) => [page, units.map((u) => u.markdown)]),
    ).toEqual([
      [3, ["a"]],
      [5, ["b"]],
      [6, []],
    ]);
  });

  test("keeps a unit's pages inside the batch, a blank page skipped", () => {
    const placed = unitsOnPages(
      [
        unit({ markdown: "before", pageFrom: 1, pageTo: 1 }),
        unit({ markdown: "on the blank page", pageFrom: 4, pageTo: 2 }),
        unit({ markdown: "after", pageFrom: 9, pageTo: 12 }),
      ],
      [3, 5],
    );

    expect(
      [...placed.values()]
        .flat()
        .map((u) => [u.markdown, u.pageFrom, u.pageTo]),
    ).toEqual([
      ["before", 3, 3],
      ["on the blank page", 3, 3],
      ["after", 5, 5],
    ]);
  });

  test("keeps the continuation flags only at the batch's edges, and a style only on a heading", () => {
    const placed = unitsOnPages(
      [
        unit({
          continuesFromPreviousBatch: true,
          continuesOnNextBatch: true,
          style: "bold",
        }),
        unit({
          label: "heading",
          style: "large",
          continuesFromPreviousBatch: true,
        }),
        unit({ continuesFromPreviousBatch: true, continuesOnNextBatch: true }),
      ],
      [1],
    );

    expect(
      placed
        .get(1)!
        .map((u) => [
          u.style,
          u.continuesFromPreviousBatch,
          u.continuesOnNextBatch,
        ]),
    ).toEqual([
      [null, true, false],
      ["large", false, false],
      [null, false, true],
    ]);
  });
});
