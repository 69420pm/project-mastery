import { describe, expect, test } from "vitest";
import {
  givenUp,
  joinExtractions,
  partialHash,
  unitPieces,
} from "./unit-pieces";

describe("unitPieces", () => {
  test("calls a unit whole on its first two attempts", () => {
    expect(unitPieces([5, 5, 5, 5], 0)).toEqual([{ start: 0, end: 4 }]);
    expect(unitPieces([5, 5, 5, 5], 1)).toEqual([{ start: 0, end: 4 }]);
  });

  test("halves every piece by characters on each later attempt, so pieces nest", () => {
    expect(unitPieces([5, 5, 5, 5], 2)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(unitPieces([5, 5, 5, 5], 3)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ]);
    expect(unitPieces([1, 1, 1, 10], 2)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 4 },
    ]);
  });
});

describe("givenUp", () => {
  test("gives a single chunk up after two failures", () => {
    expect(givenUp([100], 1)).toBe(false);
    expect(givenUp([100], 2)).toBe(true);
  });

  test("gives a unit up once its split into single chunks failed twice", () => {
    expect(givenUp([5, 5], 2)).toBe(false);
    expect(givenUp([5, 5], 3)).toBe(false);
    expect(givenUp([5, 5], 4)).toBe(true);
  });
});

test("partialHash is a 64-character hash other than the unit's own", () => {
  const own = "a".repeat(64);
  expect(partialHash(own)).toHaveLength(64);
  expect(partialHash(own)).not.toBe(own);
});

test("joinExtractions shifts Prerequisites and new KCs to the joined KCs", () => {
  const kc = (name: string) => ({
    name,
    description: name,
    chunkIds: [`chunk-${name}`],
    assumes: [],
  });
  const exercise = (chunkId: string, newKcs: number[]) => ({
    chunkId,
    solutionChunkId: null,
    notAnExercise: false,
    kcIds: [],
    newKcs,
    finalAnswers: [],
    solutionLines: null,
  });
  const joined = joinExtractions([
    {
      kcs: [kc("A"), kc("B")],
      prerequisites: [{ from: 0, to: 1 }],
      exercises: [exercise("e1", [1])],
      readChunkIds: ["e1"],
    },
    {
      kcs: [kc("C"), kc("D")],
      prerequisites: [{ from: 1, to: 0 }],
      exercises: [exercise("e2", [0, 1])],
      readChunkIds: ["e2"],
    },
  ]);
  expect(joined.kcs.map((k) => k.name)).toEqual(["A", "B", "C", "D"]);
  expect(joined.prerequisites).toEqual([
    { from: 0, to: 1 },
    { from: 3, to: 2 },
  ]);
  expect(joined.exercises?.map((e) => e.newKcs)).toEqual([[1], [2, 3]]);
  expect(joined.readChunkIds).toEqual(["e1", "e2"]);
});
