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
      {
        chapterId: "root",
        unit: 0,
        chapterIds: ["root"],
        chunkIds: ["a", "b", "c", "d"],
      },
    ]);
  });

  test("splits a big Chapter into its own chunks and its children, one unit per child, in reading order", () => {
    const chunks = [
      chunk("intro", "vs", 30),
      chunk("b", "4.1", 30),
      chunk("c", "4.2", 30),
      chunk("d", "lm", 30),
    ];
    expect(chapterUnits(chapters, chunks, 90)).toEqual([
      {
        chapterId: "vs",
        unit: 0,
        chapterIds: ["vs"],
        chunkIds: ["intro", "b", "c"],
      },
      { chapterId: "lm", unit: 0, chapterIds: ["lm"], chunkIds: ["d"] },
    ]);
    expect(chapterUnits(chapters, chunks, 60)).toEqual([
      {
        chapterId: "4.1",
        unit: 0,
        chapterIds: ["vs", "4.1"],
        chunkIds: ["intro", "b"],
      },
      { chapterId: "4.2", unit: 0, chapterIds: ["4.2"], chunkIds: ["c"] },
      { chapterId: "lm", unit: 0, chapterIds: ["lm"], chunkIds: ["d"] },
    ]);
  });

  test("gives a big Chapter's own chunks to the unit of its first child, whose Chapters are all listed", () => {
    const chunks = [
      chunk("intro", "vs", 30),
      chunk("b", "4.1", 30),
      chunk("c", "4.2", 50),
      chunk("d", "lm", 30),
    ];
    expect(chapterUnits(chapters, chunks, 80)).toEqual([
      {
        chapterId: "4.1",
        unit: 0,
        chapterIds: ["vs", "4.1"],
        chunkIds: ["intro", "b"],
      },
      { chapterId: "4.2", unit: 0, chapterIds: ["4.2"], chunkIds: ["c"] },
      { chapterId: "lm", unit: 0, chapterIds: ["lm"], chunkIds: ["d"] },
    ]);
  });

  test("keeps a big Chapter's own chunks as a unit of their own when they alone pass the cap", () => {
    const chunks = [chunk("intro", "vs", 60), chunk("b", "4.1", 30)];
    expect(chapterUnits(chapters, chunks, 50)).toEqual([
      { chapterId: "vs", unit: 0, chapterIds: ["vs"], chunkIds: ["intro"] },
      { chapterId: "4.1", unit: 0, chapterIds: ["4.1"], chunkIds: ["b"] },
    ]);
  });

  test("packs consecutive sibling Chapters that each fit, up to the cap", () => {
    const flat = [
      { id: "root", parentId: null },
      ...["1", "2", "3", "4", "5"].map((id) => ({ id, parentId: "root" })),
    ];
    const chunks = [
      chunk("a", "1", 20),
      chunk("b", "2", 20),
      chunk("c", "3", 20),
      chunk("d1", "4", 40),
      chunk("d2", "4", 40),
      chunk("e", "5", 20),
    ];
    expect(chapterUnits(flat, chunks, 50)).toEqual([
      { chapterId: "1", unit: 0, chapterIds: ["1", "2"], chunkIds: ["a", "b"] },
      { chapterId: "3", unit: 0, chapterIds: ["3"], chunkIds: ["c"] },
      { chapterId: "4", unit: 0, chapterIds: ["4"], chunkIds: ["d1"] },
      { chapterId: "4", unit: 1, chapterIds: ["4"], chunkIds: ["d2"] },
      { chapterId: "5", unit: 0, chapterIds: ["5"], chunkIds: ["e"] },
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
      {
        chapterId: "4.1",
        unit: 0,
        chapterIds: ["root", "4.1"],
        chunkIds: ["x", "b1"],
      },
      {
        chapterId: "4.1",
        unit: 1,
        chapterIds: ["root", "4.1"],
        chunkIds: ["b2", "b3"],
      },
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
