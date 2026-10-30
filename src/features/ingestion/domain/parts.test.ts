import { describe, expect, test } from "vitest";
import { buildParts, type PartChunk } from "@/features/ingestion/domain/parts";

const words = (count: number) =>
  Array.from({ length: count }, () => "word").join(" ");

const chunk = (overrides: Partial<PartChunk>): PartChunk => ({
  label: "content",
  markdown: words(10),
  pageFrom: 1,
  pageTo: 1,
  exerciseNumber: null,
  key: null,
  chapter: "Chapter 1",
  ...overrides,
});

const summary = (chunks: PartChunk[]) =>
  buildParts(chunks, "Script").map((part) => [
    part.kind,
    part.title,
    part.chunks,
  ]);

describe("teaching Parts", () => {
  test("a heading starts a Part, chunks before the first form one titled by the Material, and small ones join the next in their chapter", () => {
    expect(
      summary([
        chunk({ markdown: words(500) }),
        chunk({ markdown: `## Groups\n\n${words(50)}` }),
        chunk({ markdown: words(400) }),
        chunk({ markdown: `## Rings\n\n${words(500)}` }),
      ]),
    ).toEqual([
      ["teaching", "Script", [0]],
      ["teaching", "Groups", [1, 2]],
      ["teaching", "Rings", [3]],
    ]);
  });

  test("a small Part at the end of its chapter joins the previous one, not the next chapter's", () => {
    expect(
      summary([
        chunk({ markdown: `## Groups\n\n${words(500)}` }),
        chunk({ markdown: `## Remark\n\n${words(20)}` }),
        chunk({ markdown: `## Fields\n\n${words(500)}`, chapter: "Chapter 2" }),
      ]),
    ).toEqual([
      ["teaching", "Groups", [0, 1]],
      ["teaching", "Fields", [2]],
    ]);
  });

  test("a Part over 4,000 words splits at its next heading, else at a page boundary", () => {
    expect(
      summary([
        chunk({ markdown: `## Groups\n\n${words(3000)}` }),
        chunk({ markdown: words(1500) }),
        chunk({ markdown: words(100), pageFrom: 2, pageTo: 2 }),
        chunk({
          markdown: `### Subgroups\n\n${words(100)}`,
          pageFrom: 2,
          pageTo: 2,
        }),
      ]),
    ).toEqual([
      ["teaching", "Groups", [0, 1, 2]],
      ["teaching", "Subgroups", [3]],
    ]);
    expect(
      summary([
        chunk({ markdown: `## Groups\n\n${words(3000)}` }),
        chunk({ markdown: words(1500) }),
        chunk({ markdown: words(100) }),
        chunk({ markdown: words(100), pageFrom: 2, pageTo: 2 }),
      ]).map(([, , chunks]) => chunks),
    ).toEqual([[0, 1, 2], [3]]);
  });
});

describe("exercise Parts", () => {
  test("a run of one label with one root key is a Part; the same key again later, or without a key, is another", () => {
    const exercise = (key: string | null, number: string | null) =>
      chunk({ label: "exercise", key, exerciseNumber: number });
    const solution = (key: string) =>
      chunk({ label: "solution", key, exerciseNumber: key });
    expect(
      summary([
        chunk({ label: "admin" }),
        exercise("3", "Problem 3"),
        exercise("3.a", "(a)"),
        exercise("4", "Problem 4"),
        solution("3"),
        solution("3.a"),
        exercise("3", "Problem 3"),
        exercise(null, null),
        exercise(null, null),
      ]),
    ).toEqual([
      ["exercise", "Problem 3", [1, 2]],
      ["exercise", "Problem 4", [3]],
      ["exercise", "3", [4, 5]],
      ["exercise", "Problem 3", [6]],
      ["exercise", "Script", [7]],
      ["exercise", "Script", [8]],
    ]);
  });
});
