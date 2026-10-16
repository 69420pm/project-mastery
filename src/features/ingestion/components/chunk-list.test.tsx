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

function renderList(
  chunks: ChunkView[],
  findings: React.ComponentProps<typeof ChunkList>["findings"] = {},
) {
  const material: MaterialChunks = {
    materialId: "m1",
    courseId: "course",
    name: "Lecture 1",
    parseStatus: "parsed",
    exam: null,
    chunks,
  };
  return render(
    <ChunkList
      material={material}
      backHref="/materials"
      materialHref={(id) => `/materials/${id}`}
      briefHref="/brief"
      findings={findings}
    />,
  );
}

test("a figure chunk shows its description and no image", () => {
  const { container } = renderList([
    chunk({ label: "figure", figure: { description: "A parabola." } }),
  ]);

  expect(screen.getByText("A parabola.")).toBeTruthy();
  expect(container.querySelector("img, canvas")).toBeNull();
});

test("open and answered Findings show under their chunks", () => {
  renderList([chunk({ id: "c1" }), chunk({ id: "c2", position: 1 })], {
    c1: [{ id: "f1", text: "Open finding", status: "open", answer: null }],
    c2: [
      {
        id: "f2",
        text: "Answered finding",
        status: "answered",
        answer: "My answer",
      },
    ],
  });

  const [first, second] = screen.getAllByRole("article");
  expect(within(first!).getByText("Open finding")).toBeTruthy();
  expect(within(first!).getByText("Open")).toBeTruthy();
  expect(
    within(first!)
      .getByRole("link", { name: "Answer in the Brief" })
      .getAttribute("href"),
  ).toBe("/brief");
  expect(within(second!).getByText("Answered finding")).toBeTruthy();
  expect(within(second!).getByText("Answered")).toBeTruthy();
  expect(within(second!).getByText("My answer")).toBeTruthy();
  expect(within(second!).queryByRole("link", { name: /Brief/ })).toBeNull();
});
