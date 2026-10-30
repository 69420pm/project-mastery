import { describe, expect, test } from "vitest";
import {
  joinUnits,
  MAX_CHUNK_CHARS,
  type JoinUnit,
} from "@/features/ingestion/domain/chunk-joining";

const unit = (
  markdown: string,
  overrides: Partial<JoinUnit> = {},
): JoinUnit => ({
  markdown,
  label: "content",
  exerciseNumber: null,
  continuesFromPreviousPage: false,
  continuesOnNextPage: false,
  ...overrides,
});

const summary = (pages: Parameters<typeof joinUnits>[0]) =>
  joinUnits(pages).map((chunk) => [
    chunk.pageFrom,
    chunk.pageTo,
    chunk.markdown,
  ]);

describe("joinUnits", () => {
  test("joins a sentence over a page break, past an admin unit, which stays its own chunk", () => {
    expect(
      summary([
        {
          pageNumber: 1,
          units: [unit("A group is a set with", { continuesOnNextPage: true })],
        },
        {
          pageNumber: 2,
          units: [
            unit("Exam on 3 March.", { label: "admin" }),
            unit("an associative operation."),
          ],
        },
      ]),
    ).toEqual([
      [1, 2, "A group is a set with\n\nan associative operation."],
      [2, 2, "Exam on 3 March."],
    ]);
  });

  test("chains over 3 pages and stops before a 4th", () => {
    const flagged = unit("and so on", { continuesOnNextPage: true });
    expect(
      summary(
        [1, 2, 3, 4].map((pageNumber) => ({ pageNumber, units: [flagged] })),
      ).map(([from, to]) => [from, to]),
    ).toEqual([
      [1, 3],
      [4, 4],
    ]);
  });

  test("never joins units on one page, whatever their flags", () => {
    expect(
      summary([
        {
          pageNumber: 1,
          units: [
            unit("First part", { continuesOnNextPage: true }),
            unit("second part", { continuesFromPreviousPage: true }),
          ],
        },
      ]),
    ).toHaveLength(2);
  });

  test("a flag without text evidence does not join; a subtask label or lower case is evidence", () => {
    const closed = unit("This ends.", { continuesOnNextPage: true });
    expect(
      summary([
        { pageNumber: 1, units: [closed] },
        { pageNumber: 2, units: [unit("New Topic")] },
      ]),
    ).toHaveLength(2);
    expect(
      summary([
        { pageNumber: 1, units: [closed] },
        {
          pageNumber: 2,
          units: [unit("**b)** Show that", { label: "exercise" })],
        },
      ]),
    ).toHaveLength(1);
    expect(
      summary([
        {
          pageNumber: 1,
          units: [unit("$$x = 1$$", { continuesOnNextPage: true })],
        },
        {
          pageNumber: 2,
          units: [unit("which gives", { continuesFromPreviousPage: false })],
        },
      ]),
    ).toHaveLength(1);
  });

  test("keeps the first unit's label and its first exercise number", () => {
    const [chunk] = joinUnits([
      {
        pageNumber: 1,
        units: [
          unit("Exercise 3:", { label: "exercise", continuesOnNextPage: true }),
        ],
      },
      {
        pageNumber: 2,
        units: [unit("show it.", { label: "content", exerciseNumber: "3" })],
      },
    ]);
    expect(chunk).toMatchObject({ label: "exercise", exerciseNumber: "3" });
  });

  test("stops a join before the chunk passes the size cap", () => {
    const long = "x".repeat(MAX_CHUNK_CHARS / 2);
    expect(
      summary([
        { pageNumber: 1, units: [unit(long, { continuesOnNextPage: true })] },
        { pageNumber: 2, units: [unit(long, { continuesOnNextPage: true })] },
      ]),
    ).toHaveLength(2);
  });

  test.each([
    ["  7.2a ", "7.2a"],
    ["", null],
    ["x".repeat(51), null],
  ])("stores the exercise number %j as %j", (exerciseNumber, expected) => {
    const [chunk] = joinUnits([
      { pageNumber: 1, units: [unit("a)", { exerciseNumber })] },
    ]);
    expect(chunk?.exerciseNumber).toBe(expected);
  });

  test("takes the number of a later unit when the first one's is unusable", () => {
    const [chunk] = joinUnits([
      {
        pageNumber: 1,
        units: [
          unit("Show that", { exerciseNumber: "", continuesOnNextPage: true }),
        ],
      },
      {
        pageNumber: 2,
        units: [unit("it holds.", { exerciseNumber: "7.2" })],
      },
    ]);
    expect(chunk?.exerciseNumber).toBe("7.2");
  });
});
