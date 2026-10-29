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
    figure: null,
    exerciseNumber: null,
    points: null,
    solution: null,
    ...overrides,
  };
}

function renderList(chunks: ChunkView[], exam: MaterialChunks["exam"] = null) {
  const material: MaterialChunks = {
    materialId: "m1",
    courseId: "course",
    name: "Lecture 1",
    parseStatus: "parsed",
    exam,
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

test("a figure chunk shows its description and no image", () => {
  const { container } = renderList([
    chunk({ label: "content", figure: { description: "A parabola." } }),
  ]);

  expect(screen.getByText("A parabola.")).toBeTruthy();
  expect(container.querySelector("img, canvas")).toBeNull();
});

test.each([
  [{ year: 2024, totalPoints: 60 }, "Old exam · 2024 · 60 points in total"],
  [{ year: null, totalPoints: 1 }, "Old exam · 1 point in total"],
  [{ year: 2023, totalPoints: null }, "Old exam · 2023"],
  [{ year: null, totalPoints: null }, "Old exam"],
])("an exam %o has the header %s", (exam, header) => {
  renderList([chunk({})], exam);

  expect(screen.getByText(header).tagName).toBe("P");
});

test("a Material that is no exam has no exam header", () => {
  renderList([chunk({})]);

  expect(screen.queryByText(/Old exam/)).toBeNull();
});

test("an exercise shows its number, points and paired solution", () => {
  renderList([
    chunk({
      id: "e1",
      label: "exercise",
      exerciseNumber: "7.2b",
      points: 1,
      solution: {
        status: "paired",
        chunkId: "s1",
        materialId: "m2",
        materialName: "Solutions 7",
        exerciseNumber: "7.2b",
      },
    }),
    chunk({ id: "e2", label: "exercise", points: 4 }),
  ]);

  const [first, second] = screen.getAllByRole("article");
  expect(within(first!).getByText("Exercise 7.2b")).toBeTruthy();
  expect(within(first!).getByText("1 point")).toBeTruthy();
  expect(
    within(first!)
      .getByRole("link", { name: "Solution in Solutions 7" })
      .getAttribute("href"),
  ).toBe("/materials/m2#chunk-s1");
  expect(within(second!).getByText("4 points")).toBeTruthy();
  expect(within(second!).queryByText(/Solution|No solution/)).toBeNull();
});

test("an exercise without a solution says so", () => {
  renderList([
    chunk({ label: "exercise", solution: { status: "no_solution" } }),
  ]);

  expect(screen.getByText("No solution")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Solution in/ })).toBeNull();
});
