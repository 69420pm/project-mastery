import { describe, expect, test } from "vitest";
import {
  chapterPath,
  checkedPairs,
  offeredIds,
  pairingCalls,
  type PairingChunk,
} from "./exercise-pairing";

/** Chunks from specs such as "e1" (an exercise) and "s1" (a solution). */
const chunks = (...specs: string[]): PairingChunk[] =>
  specs.map((id) => ({
    id,
    label: id.startsWith("e") ? "exercise" : "solution",
  }));

const ids = (runs: PairingChunk[][]) =>
  runs.map((run) => run.map((chunk) => chunk.id));

describe("pairingCalls", () => {
  test("puts the Course in runs of at most the size, in order", () => {
    expect(ids(pairingCalls(chunks("e1", "s1", "e2", "s2", "e3"), 2))).toEqual([
      ["e1", "s1"],
      ["e2", "s2"],
    ]);
  });

  test("makes no call without an exercise or without a solution", () => {
    expect(pairingCalls(chunks("e1", "e2"))).toEqual([]);
    expect(pairingCalls(chunks("s1"))).toEqual([]);
    expect(pairingCalls([])).toEqual([]);
  });
});

describe("checkedPairs", () => {
  const offered = offeredIds(
    chunks("ex-a", "sol-a", "ex-b", "sol-b").map((chunk, index) => ({
      ...chunk,
      label: index % 2 === 0 ? "exercise" : "solution",
    })),
  );

  test("numbers exercises and solutions apart", () => {
    expect([...offered].map(([id, chunk]) => [id, chunk.id])).toEqual([
      ["e1", "ex-a"],
      ["s1", "sol-a"],
      ["e2", "ex-b"],
      ["s2", "sol-b"],
    ]);
  });

  test("keeps the first solution per exercise, and one solution may solve several", () => {
    expect(
      checkedPairs(
        [
          { exerciseId: "e1", solutionId: "s2" },
          { exerciseId: "e1", solutionId: "s1" },
          { exerciseId: "e2", solutionId: "s2" },
        ],
        offered,
      ),
    ).toEqual(
      new Map([
        ["ex-a", "sol-b"],
        ["ex-b", "sol-b"],
      ]),
    );
  });

  test("drops unknown ids and ids of the wrong kind", () => {
    expect(
      checkedPairs(
        [
          { exerciseId: "e9", solutionId: "s1" },
          { exerciseId: "e1", solutionId: "s7" },
          { exerciseId: "s1", solutionId: "e1" },
          { exerciseId: "e2", solutionId: "e1" },
        ],
        offered,
      ),
    ).toEqual(new Map());
  });
});

describe("chapterPath", () => {
  const chapters = new Map([
    ["root", { parentId: null, depth: 0, title: "Notes.pdf" }],
    ["c4", { parentId: "root", depth: 1, title: "4 Vector Spaces" }],
    ["c42", { parentId: "c4", depth: 2, title: "4.2 Subspaces" }],
  ]);

  test("reads the titles below the root, top first", () => {
    expect(chapterPath("c42", chapters)).toEqual([
      "4 Vector Spaces",
      "4.2 Subspaces",
    ]);
  });

  test("is empty for the root or no Chapter", () => {
    expect(chapterPath("root", chapters)).toEqual([]);
    expect(chapterPath(null, chapters)).toEqual([]);
  });
});
