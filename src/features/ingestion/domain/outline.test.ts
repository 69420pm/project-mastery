import { describe, expect, test } from "vitest";
import {
  chaptersFromPdfOutline,
  outlineChapters,
  type ProposedChapter,
} from "@/features/ingestion/domain/outline";

const units = [
  { label: "content" as const, pageFrom: 17 },
  { label: "heading" as const, pageFrom: 18 }, // h1: 4 Vector Spaces
  { label: "heading" as const, pageFrom: 18 }, // h2: 4.1 Subspaces
  { label: "content" as const, pageFrom: 18 },
  { label: "heading" as const, pageFrom: 20 }, // h3: 4.2 Bases
  { label: "content" as const, pageFrom: 21 },
];

const chapter = (overrides: Partial<ProposedChapter>): ProposedChapter => ({
  title: "Chapter",
  level: 1,
  heading: null,
  page: null,
  exam: false,
  ...overrides,
});

const tree = (proposed: ProposedChapter[]) =>
  outlineChapters("lecture-notes.pdf", units, proposed).map((c) => [
    c.position,
    c.parentPosition,
    c.depth,
    c.title,
    c.pageFrom,
    c.startUnit,
  ]);

describe("outlineChapters", () => {
  test("hangs the proposed Chapters below a root titled by the Material's name, each under the nearest Chapter of a lower level", () => {
    expect(
      tree([
        chapter({ title: "4 Vector Spaces", heading: "h1" }),
        chapter({ title: "4.1 Subspaces", level: 2, heading: "h2" }),
        chapter({ title: "4.2 Bases", level: 3, heading: "h3" }),
        chapter({ title: "5 Maps", level: 1, page: 21 }),
      ]),
    ).toEqual([
      [0, null, 0, "lecture-notes.pdf", 1, 0],
      [1, 0, 1, "4 Vector Spaces", 18, 1],
      [2, 1, 2, "4.1 Subspaces", 18, 2],
      [3, 2, 3, "4.2 Bases", 20, 4],
      [4, 0, 1, "5 Maps", 21, 5],
    ]);
  });

  test("starts a Chapter with an unknown or used heading on its page, and drops one with no start, no title or a start before the Chapter kept before it", () => {
    expect(
      tree([
        chapter({ title: "4.2 Bases", heading: "h3" }),
        chapter({ title: "Earlier", heading: "h1" }),
        chapter({ title: "Unknown id", heading: "h9", page: 21 }),
        chapter({ title: "Used id", heading: "h3", page: 30 }),
        chapter({ title: "  ", heading: "h2" }),
      ]),
    ).toEqual([
      [0, null, 0, "lecture-notes.pdf", 1, 0],
      [1, 0, 1, "4.2 Bases", 20, 4],
      [2, 0, 1, "Unknown id", 21, 5],
    ]);
  });

  test("takes the PDF outline's entries as Chapters starting on their pages", () => {
    const proposed = chaptersFromPdfOutline([
      { title: "Part I", level: 1, page: 3 },
      { title: "4 Vector Spaces", level: 2, page: 18 },
    ]);

    expect(tree(proposed)).toEqual([
      [0, null, 0, "lecture-notes.pdf", 1, 0],
      [1, 0, 1, "Part I", 17, 0],
      [2, 1, 2, "4 Vector Spaces", 18, 1],
    ]);
  });

  test("starts a Chapter on a page without units at the first unit after it, unless the next Chapter starts first", () => {
    expect(
      tree([
        chapter({ title: "Title page", page: 3 }),
        chapter({ title: "Squeezed", page: 19 }),
        chapter({ title: "4.2 Bases", heading: "h3" }),
        chapter({ title: "Beyond", page: 40 }),
      ]),
    ).toEqual([
      [0, null, 0, "lecture-notes.pdf", 1, 0],
      [1, 0, 1, "Title page", 17, 0],
      [2, 0, 1, "4.2 Bases", 20, 4],
    ]);
  });
});
