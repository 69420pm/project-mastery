import { expect, test } from "vitest";
import {
  chapterLevel,
  chunkChapters,
  type OutlineEntry,
} from "@/features/ingestion/domain/chapters";

const entry = (level: number, title: string, page: number): OutlineEntry => ({
  level,
  title,
  page,
});

test("the chapter level is the shallowest with 3 entries, else the one with the most, the shallower on a tie", () => {
  expect(
    chapterLevel([
      entry(1, "I", 1),
      entry(2, "A", 2),
      entry(2, "B", 3),
      entry(2, "C", 4),
    ]),
  ).toBe(2);
  expect(
    chapterLevel([
      entry(1, "III", 1),
      entry(2, "Final", 2),
      entry(3, "Solutions", 3),
      entry(2, "Resit", 7),
      entry(3, "Solutions", 8),
    ]),
  ).toBe(2);
  expect(chapterLevel([])).toBeNull();
});

test("a chunk takes the chapter that covers its first page, else the deepest entry above that covers it", () => {
  const outline = [
    entry(1, "Course Information", 3),
    entry(1, "I Lecture Notes", 9),
    entry(2, "Preliminaries", 10),
    entry(3, "Sets", 10),
    entry(2, "Groups", 13),
    entry(2, "Vector Spaces", 19),
  ];
  const chunk = (pageFrom: number) => ({ pageFrom, markdown: "Text" });
  expect(
    chunkChapters([1, 4, 11, 13, 30].map(chunk), outline, "Notes"),
  ).toEqual([
    "Notes",
    "Course Information",
    "Preliminaries",
    "Groups",
    "Vector Spaces",
  ]);
});

test("without an outline, a chunk takes the last level-1 heading up to it, else the Material's name", () => {
  const chunks = [
    { pageFrom: 1, markdown: "Welcome" },
    { pageFrom: 1, markdown: "# Chapter 1\n\nText" },
    { pageFrom: 2, markdown: "## 1.1 Section" },
  ];
  expect(chunkChapters(chunks, [], "Script")).toEqual([
    "Script",
    "Chapter 1",
    "Chapter 1",
  ]);
});
