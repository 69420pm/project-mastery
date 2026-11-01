import { describe, expect, test } from "vitest";
import { chapterUnits, unitHash } from "./chapter-units";

// Root › Vector spaces (intro, 4.1, 4.2) › Linear maps.
const chapters = [
  { id: "root", parentId: null },
  { id: "vs", parentId: "root" },
  { id: "4.1", parentId: "vs" },
  { id: "4.2", parentId: "vs" },
  { id: "lm", parentId: "root" },
];

const chunk = (id: string, chapterId: string | null, chars = 10) => ({
  id,
  chapterId,
  markdown: "x".repeat(chars),
});

describe("chapterUnits", () => {
  test("makes a Chapter under the cap one unit with its whole subtree", () => {
    const chunks = [
      chunk("a", "vs"),
      chunk("b", "4.1"),
      chunk("c", "4.2"),
      chunk("d", "lm"),
    ];
    expect(chapterUnits(chapters, chunks, 100)).toEqual([
      { chapterId: "root", unit: 0, chunkIds: ["a", "b", "c", "d"] },
    ]);
  });

  test("splits a big Chapter into its children and its own chunks, in reading order", () => {
    const chunks = [
      chunk("intro", "vs", 30),
      chunk("b", "4.1", 30),
      chunk("c", "4.2", 30),
      chunk("d", "lm", 30),
    ];
    expect(chapterUnits(chapters, chunks, 90)).toEqual([
      { chapterId: "vs", unit: 0, chunkIds: ["intro", "b", "c"] },
      { chapterId: "lm", unit: 0, chunkIds: ["d"] },
    ]);
    expect(chapterUnits(chapters, chunks, 60)).toEqual([
      { chapterId: "vs", unit: 0, chunkIds: ["intro"] },
      { chapterId: "4.1", unit: 0, chunkIds: ["b"] },
      { chapterId: "4.2", unit: 0, chunkIds: ["c"] },
      { chapterId: "lm", unit: 0, chunkIds: ["d"] },
    ]);
  });

  test("splits a leaf over the cap between chunks, and files chunks without a Chapter under the root", () => {
    const chunks = [
      chunk("x", null, 5),
      chunk("b1", "4.1", 40),
      chunk("b2", "4.1", 40),
      chunk("b3", "4.1", 10),
    ];
    expect(chapterUnits(chapters, chunks, 50)).toEqual([
      { chapterId: "root", unit: 0, chunkIds: ["x"] },
      { chapterId: "4.1", unit: 0, chunkIds: ["b1"] },
      { chapterId: "4.1", unit: 1, chunkIds: ["b2", "b3"] },
    ]);
  });

  test("makes no unit without chunks", () => {
    expect(chapterUnits(chapters, [])).toEqual([]);
  });
});

test("unitHash changes with the text", () => {
  expect(unitHash("4.1", ["a"])).toHaveLength(64);
  expect(unitHash("4.1", ["a"])).not.toBe(unitHash("4.1", ["b"]));
});
