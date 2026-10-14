import { describe, expect, test } from "vitest";
import type { MapChunk } from "@/features/knowledge-map/types";
import {
  assignmentBatches,
  exerciseInputs,
  skeletonInput,
} from "./build-input";

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

describe("exerciseInputs", () => {
  const exercise = (
    id: string,
    exerciseNumber: string | null,
    page: number,
  ) => ({
    ...chunk(id, "exercise"),
    pageFrom: page,
    exerciseNumber,
  });

  test("pairs solutions and tells apart names printed twice by their page", () => {
    const inputs = exerciseInputs(
      [
        exercise("example", "7.1", 3),
        exercise("ex71", "7.1", 9),
        exercise("ex72", "7.2", 9),
        {
          ...chunk("sol", "solution", "46.5%"),
          pageFrom: 10,
          exerciseNumber: null,
        },
      ],
      { ex71: "sol", ex72: "missing" },
    );

    expect(
      inputs.map(({ id, name, solution }) => ({ id, name, solution })),
    ).toEqual([
      { id: "e1", name: "Ex. 7.1 (Lecture 1 p. 3)", solution: null },
      { id: "e2", name: "Ex. 7.1 (Lecture 1 p. 9)", solution: "46.5%" },
      { id: "e3", name: "Ex. 7.2", solution: null },
    ]);
  });
});

describe("skeletonInput", () => {
  test("lists the map's big ideas, Materials and headings once, and every definition", () => {
    const input = skeletonInput(
      [
        chunk("a", "content", "# Thrust\nText\n## Momentum ##"),
        chunk("b", "definition", "## Momentum\n**Thrust** is a force."),
        chunk("c", "content", "No heading", "Lecture 2"),
      ],
      {
        bigIdeas: [{ id: "B", name: "Cycle", description: "Brayton." }],
        kcs: [
          {
            id: "K",
            name: "Pressure ratio",
            description: "p2/p1.",
            bigIdea: "B",
            sources: [],
          },
        ],
      },
    );

    expect(input).toEqual({
      existingBigIdeas: [{ name: "Cycle", kcs: ["Pressure ratio"] }],
      materials: ["Lecture 1", "Lecture 2"],
      headings: ["Thrust", "Momentum"],
      definitions: ["## Momentum\n**Thrust** is a force."],
    });
  });
});
