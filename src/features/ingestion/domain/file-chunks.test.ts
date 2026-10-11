import { describe, expect, test } from "vitest";
import {
  coverageProblems,
  materialUnits,
  type FileChunk,
} from "@/features/ingestion/domain/file-chunks";

const unit = (markdown: string) => ({
  markdown,
  label: "content" as const,
  exerciseNumber: null,
  points: null,
  figure: null,
  continuesFromPreviousPage: false,
  continuesOnNextPage: false,
});

/** Page 1 has two units, page 2 one, page 3 one. */
const pages = [
  { pageNumber: 2, units: [unit("c")] },
  { pageNumber: 1, units: [unit("a"), unit("b")] },
  { pageNumber: 3, units: [unit("d")] },
];

const chunk = (unitIds: string[]): FileChunk => ({
  unitIds,
  label: "content",
  exerciseNumber: null,
  points: null,
});

describe("materialUnits", () => {
  test("numbers the units in reading order, by page and then by position", () => {
    expect(
      materialUnits(pages).map(({ id, pageNumber, unit }) => [
        id,
        pageNumber,
        unit.markdown,
      ]),
    ).toEqual([
      ["p1u1", 1, "a"],
      ["p1u2", 1, "b"],
      ["p2u1", 2, "c"],
      ["p3u1", 3, "d"],
    ]);
  });

  test("gives a page without units one admin unit, so a chunk can cover it", () => {
    const units = materialUnits([
      { pageNumber: 1, units: [unit("a")] },
      { pageNumber: 2, units: [] },
    ]);

    expect(units.map(({ id, pageNumber }) => [id, pageNumber])).toEqual([
      ["p1u1", 1],
      ["p2u1", 2],
    ]);
    expect(units[1]?.unit).toMatchObject({
      label: "admin",
      markdown: "This page has no content.",
      exerciseNumber: null,
      points: null,
      figure: null,
    });
  });
});

describe("coverageProblems", () => {
  const units = materialUnits(pages);
  const pageNumbers = [1, 2, 3];

  test("accepts chunks that place every unit exactly once", () => {
    expect(
      coverageProblems(
        units,
        [chunk(["p1u1"]), chunk(["p1u2", "p2u1"]), chunk(["p3u1"])],
        pageNumbers,
      ),
    ).toEqual([]);
  });

  test("reports a unit no chunk holds", () => {
    expect(
      coverageProblems(
        units,
        [chunk(["p1u1", "p1u2"]), chunk(["p3u1"])],
        pageNumbers,
      ),
    ).toContain("Unit p2u1 is in no chunk.");
  });

  test("reports a unit two chunks hold", () => {
    expect(
      coverageProblems(
        units,
        [chunk(["p1u1", "p1u2"]), chunk(["p1u2", "p2u1"]), chunk(["p3u1"])],
        pageNumbers,
      ),
    ).toEqual(["Unit p1u2 is in 2 chunks."]);
  });

  test("reports a page no chunk covers", () => {
    expect(
      coverageProblems(
        units,
        [chunk(["p1u1", "p1u2"]), chunk(["p2u1"]), chunk(["p3u1"])],
        [1, 2, 3, 4],
      ),
    ).toEqual(["Page 4 is in no chunk."]);
  });

  test("covers a stored page without units through its placeholder unit", () => {
    const withBlankPage = materialUnits([
      ...pages,
      { pageNumber: 4, units: [] },
    ]);
    expect(
      coverageProblems(
        withBlankPage,
        [
          chunk(["p1u1", "p1u2"]),
          chunk(["p2u1"]),
          chunk(["p3u1"]),
          chunk(["p4u1"]),
        ],
        [1, 2, 3, 4],
      ),
    ).toEqual([]);
  });

  test("counts a page inside a chunk's page range as covered", () => {
    const withMiddleFigure = materialUnits([
      { pageNumber: 1, units: [unit("a")] },
      { pageNumber: 3, units: [unit("b")] },
    ]);
    expect(
      coverageProblems(withMiddleFigure, [chunk(["p1u1", "p3u1"])], [1, 2, 3]),
    ).toEqual([]);
  });

  test("reports a chunk whose units are not neighbours", () => {
    expect(
      coverageProblems(
        units,
        [chunk(["p1u1", "p2u1"]), chunk(["p1u2"]), chunk(["p3u1"])],
        pageNumbers,
      ),
    ).toEqual(["A chunk joins units that are not neighbours: p1u1, p2u1."]);
  });

  test("reports an empty chunk and an unknown unit", () => {
    expect(
      coverageProblems(
        units,
        [chunk([]), chunk(["p1u1", "p1u2", "p2u1", "p3u1", "p9u9"])],
        pageNumbers,
      ),
    ).toEqual(["A chunk has no units.", "Unit p9u9 does not exist."]);
  });
});
