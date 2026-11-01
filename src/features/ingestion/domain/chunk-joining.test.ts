import { describe, expect, test } from "vitest";
import {
  chunksFromUnits,
  MAX_CHUNK_CHARS,
} from "@/features/ingestion/domain/chunk-joining";
import type { BatchUnit } from "@/features/ingestion/domain/page-batches";

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

describe("chunksFromUnits", () => {
  test("joins a unit across a batch edge only when both flags say so and the labels match", () => {
    const chunks = chunksFromUnits([
      unit({ markdown: "A vector space is", continuesOnNextBatch: true }),
      unit({
        markdown: "a set with addition.",
        pageFrom: 6,
        pageTo: 6,
        continuesFromPreviousBatch: true,
      }),
      unit({
        label: "exercise",
        markdown: "Show it.",
        pageFrom: 6,
        pageTo: 7,
        continuesOnNextBatch: true,
      }),
      unit({
        markdown: "Unrelated.",
        pageFrom: 11,
        pageTo: 11,
        continuesFromPreviousBatch: true,
      }),
      unit({ markdown: "Not flagged.", pageFrom: 11, pageTo: 11 }),
    ]);

    expect(chunks).toMatchObject([
      {
        pageFrom: 1,
        pageTo: 6,
        label: "content",
        markdown: "A vector space is\n\na set with addition.",
      },
      { pageFrom: 6, pageTo: 7, label: "exercise", markdown: "Show it." },
      { pageFrom: 11, pageTo: 11, label: "content", markdown: "Unrelated." },
      { pageFrom: 11, pageTo: 11, label: "content", markdown: "Not flagged." },
    ]);
  });

  test("puts each heading as a bold line at the start of the next unit, and never joins across one", () => {
    const chunks = chunksFromUnits([
      unit({ markdown: "Intro", continuesOnNextBatch: true }),
      unit({
        label: "heading",
        markdown: "## 4 Vector Spaces",
        style: "title",
        pageFrom: 2,
        pageTo: 2,
      }),
      unit({
        label: "heading",
        markdown: "4.1 Definition",
        style: "bold",
        pageFrom: 2,
        pageTo: 2,
      }),
      unit({
        markdown: "Body",
        pageFrom: 2,
        pageTo: 3,
        continuesFromPreviousBatch: true,
      }),
      unit({ label: "heading", markdown: "Appendix", pageFrom: 4, pageTo: 4 }),
    ]);

    expect(chunks).toMatchObject([
      { pageFrom: 1, pageTo: 1, label: "content", markdown: "Intro" },
      {
        pageFrom: 2,
        pageTo: 3,
        label: "content",
        markdown: "**4 Vector Spaces**\n\n**4.1 Definition**\n\nBody",
      },
      { pageFrom: 4, pageTo: 4, label: "content", markdown: "**Appendix**" },
    ]);
  });

  test("cuts at every Chapter start: a Chapter's heading becomes a Markdown heading of its depth, and no unit joins across the cut", () => {
    const chunks = chunksFromUnits(
      [
        unit({ markdown: "Preface" }),
        unit({ label: "heading", markdown: "4 Vector Spaces", pageFrom: 2 }),
        unit({ label: "heading", markdown: "4.1 Subspaces", pageFrom: 2 }),
        unit({ label: "heading", markdown: "Definition 4.1.1", pageFrom: 2 }),
        unit({ markdown: "A subspace is", continuesOnNextBatch: true }),
        unit({
          markdown: "closed.",
          pageFrom: 6,
          continuesFromPreviousBatch: true,
        }),
        unit({ markdown: "From the PDF outline.", pageFrom: 7 }),
      ],
      [
        { position: 0, depth: 0, startUnit: 0, startsAtHeading: false },
        { position: 1, depth: 1, startUnit: 1, startsAtHeading: true },
        { position: 2, depth: 2, startUnit: 2, startsAtHeading: true },
        { position: 3, depth: 2, startUnit: 5, startsAtHeading: false },
      ],
    );

    expect(
      chunks.map((chunk) => [chunk.chapterPosition, chunk.markdown]),
    ).toEqual([
      [0, "Preface"],
      [1, "# 4 Vector Spaces"],
      [2, "## 4.1 Subspaces\n\n**Definition 4.1.1**\n\nA subspace is"],
      [3, "closed."],
      [3, "From the PDF outline."],
    ]);
  });

  test("splits a chunk over the cap between paragraphs, each part with its own pages", () => {
    const long = "x".repeat(MAX_CHUNK_CHARS - 3);
    const chunks = chunksFromUnits([
      unit({
        markdown: `${long}\n\nshort`,
        pageFrom: 1,
        pageTo: 2,
        continuesOnNextBatch: true,
      }),
      unit({
        markdown: "more",
        pageFrom: 3,
        pageTo: 3,
        continuesFromPreviousBatch: true,
      }),
    ]);

    expect(
      chunks.map((chunk) => [
        chunk.pageFrom,
        chunk.pageTo,
        chunk.markdown.length,
      ]),
    ).toEqual([
      [1, 2, long.length],
      [1, 3, "short\n\nmore".length],
    ]);
  });
});
