import { describe, expect, test } from "vitest";
import type { MapChunk } from "@/features/knowledge-map/types";
import { assignmentBatches, skeletonInput } from "./build-input";

const chunk = (
  id: string,
  label: string,
  markdown = id,
  materialName = "Lecture 1",
): MapChunk => ({ id, label, markdown, materialName });

describe("assignmentBatches", () => {
  test("sends teaching chunks in batches of ten, in reading order", () => {
    const chunks = [
      chunk("admin", "admin"),
      ...Array.from({ length: 11 }, (_, i) => chunk(`c${i}`, "content")),
      chunk("ex", "exercise"),
      chunk("sol", "solution"),
      chunk("def", "definition"),
      chunk("eg", "example"),
      chunk("fig", "figure"),
    ];

    const batches = assignmentBatches(chunks);

    expect(batches.map((batch) => batch.map((c) => c.id))).toEqual([
      ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"],
      ["c10", "def", "eg", "fig"],
    ]);
  });

  test("gives no batch when no chunk teaches", () => {
    expect(assignmentBatches([chunk("ex", "exercise")])).toEqual([]);
  });
});

describe("skeletonInput", () => {
  test("lists Materials and headings once, and every definition", () => {
    const input = skeletonInput([
      chunk("a", "content", "# Thrust\nText\n## Momentum ##"),
      chunk("b", "definition", "## Momentum\n**Thrust** is a force."),
      chunk("c", "content", "No heading", "Lecture 2"),
    ]);

    expect(input).toEqual({
      materials: ["Lecture 1", "Lecture 2"],
      headings: ["Thrust", "Momentum"],
      definitions: ["## Momentum\n**Thrust** is a force."],
    });
  });
});
