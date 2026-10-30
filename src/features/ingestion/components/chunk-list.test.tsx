import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { ChunkList } from "@/features/ingestion/components/chunk-list";
import type { ChunkView, MaterialChunks } from "@/features/ingestion/types";

function chunk(overrides: Partial<ChunkView>): ChunkView {
  return {
    id: "c1",
    position: 0,
    pageFrom: 1,
    pageTo: 1,
    label: "content",
    markdown: "Some text",
    exerciseNumber: null,
    solution: null,
    ...overrides,
  };
}

function renderList(chunks: ChunkView[], isExam = false) {
  const material: MaterialChunks = {
    materialId: "m1",
    courseId: "course",
    name: "Lecture 1",
    parseStatus: "parsed",
    isExam,
    chunks,
  };
  return render(
    <ChunkList
      material={material}
      backHref="/materials"
      materialHref={(id) => `/materials/${id}`}
    />,
  );
}

test("an old exam says so in its header", () => {
  renderList([chunk({})], true);

  expect(screen.getByText("Old exam").tagName).toBe("P");
});

test("a Material that is no exam has no exam header", () => {
  renderList([chunk({})]);

  expect(screen.queryByText(/Old exam/)).toBeNull();
});

test("an exercise shows its number and paired solution", () => {
  renderList([
    chunk({
      id: "e1",
      label: "exercise",
      exerciseNumber: "7.2b",
      solution: {
        status: "paired",
        chunkId: "s1",
        materialId: "m2",
        materialName: "Solutions 7",
        exerciseNumber: "7.2b",
      },
    }),
    chunk({ id: "e2", label: "exercise" }),
  ]);

  const [first, second] = screen.getAllByRole("article");
  expect(within(first!).getByText("Exercise 7.2b")).toBeTruthy();
  expect(
    within(first!)
      .getByRole("link", { name: "Solution in Solutions 7" })
      .getAttribute("href"),
  ).toBe("/materials/m2#chunk-s1");
  expect(within(second!).queryByText(/Solution|No solution/)).toBeNull();
});

test("an exercise without a solution says so", () => {
  renderList([
    chunk({ label: "exercise", solution: { status: "no_solution" } }),
  ]);

  expect(screen.getByText("No solution")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Solution in/ })).toBeNull();
});
