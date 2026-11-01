import { describe, expect, it } from "vitest";
import {
  chapterSubtree,
  examChapterIds,
} from "@/features/ingestion/domain/old-exam-chapters";

// Script › Vector Spaces › 4.1, and Script › Old exam 2023 › Problem 1.
const chapters = [
  { id: "script", parentId: null, isExam: false },
  { id: "vs", parentId: "script", isExam: false },
  { id: "4.1", parentId: "vs", isExam: false },
  { id: "exam", parentId: "script", isExam: true },
  { id: "p1", parentId: "exam", isExam: false },
];

describe("examChapterIds", () => {
  it("covers a confirmed Chapter's subtree and nothing above or beside it", () => {
    expect(examChapterIds(chapters)).toEqual(new Set(["exam", "p1"]));
  });

  it("covers a whole Material when its root is confirmed", () => {
    const root = chapters.map((c) => ({ ...c, isExam: c.id === "script" }));
    expect(examChapterIds(root).size).toBe(chapters.length);
  });
});

describe("chapterSubtree", () => {
  it("is the Chapter and every Chapter below it", () => {
    expect(chapterSubtree(chapters, "vs")).toEqual(new Set(["vs", "4.1"]));
  });

  it("is empty for an unknown Chapter", () => {
    expect(chapterSubtree(chapters, "gone").size).toBe(0);
  });
});
