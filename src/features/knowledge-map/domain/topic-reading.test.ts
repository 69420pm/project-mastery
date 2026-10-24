import { describe, expect, test } from "vitest";
import { readingSections, topicAnchors, type ChunkSpan } from "./topic-reading";

const span = (
  id: string,
  materialId: string,
  pageFrom: number,
  pageTo = pageFrom,
): ChunkSpan => ({
  id,
  materialId,
  materialName: `Material ${materialId}`,
  pageFrom,
  pageTo,
});

describe("topicAnchors", () => {
  const kc = (id: string) => ({ id, name: `KC ${id}` }) as never;
  const link = (from: string, to: string) => ({ from, to }) as never;
  const map = {
    kcs: ["p", "a", "b", "c", "d"].map(kc),
    prerequisites: [
      link("d", "b"),
      link("p", "a"),
      link("a", "b"),
      link("p", "b"),
      link("c", "d"),
    ],
  };

  test("are the outside Prerequisites of the Topic's KCs, once each, in map order", () => {
    expect(topicAnchors(["a", "b"], map)).toEqual([
      { id: "p", name: "KC p" },
      { id: "d", name: "KC d" },
    ]);
  });

  test("are empty when every Prerequisite is inside the Topic", () => {
    expect(topicAnchors(["a", "b", "p", "d", "c"], map)).toEqual([]);
  });
});

describe("readingSections", () => {
  test("holds the cited chunks once, in Material order, whatever the citing order", () => {
    const chunks = [span("a", "m1", 1), span("b", "m1", 2), span("c", "m1", 3)];
    expect(readingSections(["c", "a", "a"], chunks)).toEqual([
      expect.objectContaining({ pageFrom: 1, pageTo: 3, chunkIds: ["a", "c"] }),
    ]);
  });

  test("starts a new section when the Material changes", () => {
    const chunks = [span("a", "m1", 5), span("b", "m2", 5), span("c", "m2", 6)];
    expect(readingSections(["a", "b", "c"], chunks)).toEqual([
      expect.objectContaining({ materialId: "m1", chunkIds: ["a"] }),
      expect.objectContaining({
        materialId: "m2",
        materialName: "Material m2",
        pageFrom: 5,
        pageTo: 6,
        chunkIds: ["b", "c"],
      }),
    ]);
  });

  test("keeps 3 pages in a section and cuts at the 4th", () => {
    const chunks = [1, 2, 3, 4, 5].map((page) => span(`p${page}`, "m1", page));
    const sections = readingSections(
      chunks.map((chunk) => chunk.id),
      chunks,
    );
    expect(sections.map((s) => [s.pageFrom, s.pageTo])).toEqual([
      [1, 3],
      [4, 5],
    ]);
  });

  test("cuts by the pages a chunk spans, and keeps a longer chunk alone", () => {
    const chunks = [
      span("a", "m1", 1, 2),
      span("b", "m1", 3, 4),
      span("c", "m1", 5, 9),
    ];
    expect(
      readingSections(["a", "b", "c"], chunks).map((s) => s.chunkIds),
    ).toEqual([["a"], ["b"], ["c"]]);
  });

  test("measures the span from a section's first page, not from gaps", () => {
    const chunks = [span("a", "m1", 1), span("b", "m1", 3), span("c", "m1", 9)];
    expect(
      readingSections(["a", "b", "c"], chunks).map((s) => s.chunkIds),
    ).toEqual([["a", "b"], ["c"]]);
  });

  test("is empty without cited chunks", () => {
    expect(readingSections([], [span("a", "m1", 1)])).toEqual([]);
  });
});
