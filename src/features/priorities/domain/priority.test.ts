import { describe, expect, test } from "vitest";
import {
  baseFactors,
  priorities,
  priorityLevels,
  type PriorityInput,
} from "./priority";

/** A Course: chunks l1–l2 in "Lecture", l3 in "Sheet 1", e1–e2 in "Exam 2024". */
function course(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return {
    kcs: ["a", "b", "c", "d"].map((id) => ({
      id,
      prior: false,
      sources: ["l1"],
    })),
    prerequisites: [],
    exercises: [],
    chunks: {
      l1: { materialId: "lecture", points: null },
      l2: { materialId: "lecture", points: null },
      l3: { materialId: "sheet", points: 4 },
      e1: { materialId: "exam", points: 6 },
      e2: { materialId: "exam", points: 2 },
    },
    materials: {
      lecture: { name: "Lecture", isExam: false },
      sheet: { name: "Sheet 1", isExam: false },
      exam: { name: "Exam 2024", isExam: true },
    },
    ...overrides,
  };
}

const factor = (
  input: PriorityInput,
  key: "exam" | "exercises" | "dependents",
) =>
  Object.fromEntries(
    [...baseFactors(input)].map(([id, factors]) => [id, factors[key]]),
  );

describe("base factors", () => {
  test("exam points are split across an exam Exercise's KCs, over the largest sum", () => {
    const input = course({
      exercises: [
        // A KC listed twice counts once.
        { questionChunk: "e1", kcs: ["a", "b", "b"] },
        { questionChunk: "e2", kcs: ["a"] },
        // Points outside an exam Material count nothing.
        { questionChunk: "l3", kcs: ["c"] },
      ],
    });
    // a: 3 + 2 = 5, b: 3.
    expect(factor(input, "exam")).toEqual({ a: 1, b: 0.6, c: 0, d: 0 });
  });

  test("Exercises using a KC, over the most", () => {
    const input = course({
      exercises: [
        { questionChunk: "l1", kcs: ["a", "b"] },
        { questionChunk: "l2", kcs: ["a"] },
      ],
    });
    expect(factor(input, "exercises")).toEqual({ a: 1, b: 0.5, c: 0, d: 0 });
  });

  test("dependents count KCs that need it directly or indirectly", () => {
    const input = course({
      prerequisites: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
      ],
    });
    expect(factor(input, "dependents")).toEqual({ a: 1, b: 0.5, c: 0, d: 0 });
  });

  test.each<[string, Partial<PriorityInput>, Record<string, number>]>([
    [
      "a cycle counts each other KC once, never the KC itself",
      {
        prerequisites: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" },
        ],
      },
      { a: 2, b: 2, c: 2, d: 0 },
    ],
    [
      "a Prerequisite naming an unknown KC adds only known ones",
      {
        prerequisites: [
          { from: "a", to: "x" },
          { from: "x", to: "b" },
        ],
      },
      { a: 2, b: 0, c: 0, d: 0 },
    ],
  ])("dependents: %s", (_, overrides, expected) => {
    const counts = Object.fromEntries(
      [...baseFactors(course(overrides))].map(([id, f]) => [
        id,
        f.dependentCount,
      ]),
    );
    expect(counts).toEqual(expected);
  });

  test.each([
    ["a duplicate KC id counts once", ["a", "a"]],
    ["an unknown KC id counts nothing and takes no share", ["a", "zz"]],
  ])("an exam Exercise: %s", (_, kcs) => {
    const factors = baseFactors(
      course({ exercises: [{ questionChunk: "e1", kcs }] }),
    );
    expect(
      [...factors].map(([id, f]) => [id, f.exerciseCount, f.examPoints]),
    ).toEqual([
      ["a", 1, 6],
      ["b", 0, 0],
      ["c", 0, 0],
      ["d", 0, 0],
    ]);
  });

  test.each([
    ["a non-exam Material", "l3"],
    ["a chunk without points", "l1"],
    ["an unknown chunk", "nope"],
  ])("points of %s count nothing", (_, questionChunk) => {
    const factors = baseFactors(
      course({ exercises: [{ questionChunk, kcs: ["a"] }] }),
    );
    expect(factors.get("a")?.examPoints).toBe(0);
  });

  test("a largest value of 0 makes the factor 0 for every KC", () => {
    expect(factor(course(), "exam")).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });
});

describe("priorities", () => {
  const byKc = (input: PriorityInput, excluded: string[] = []) =>
    Object.fromEntries(
      priorities(input, new Set(excluded)).map((p) => [p.kcId, p]),
    );

  test("weigh exam points half and Exercises and dependents a quarter each", () => {
    const result = byKc(
      course({
        exercises: [
          { questionChunk: "e1", kcs: ["a"] },
          { questionChunk: "l1", kcs: ["b"] },
        ],
        prerequisites: [{ from: "c", to: "a" }],
      }),
    );
    expect(result.a?.priority).toBe(0.75);
    expect(result.b?.priority).toBe(0.25);
    expect(result.c?.priority).toBe(0.25);
    expect(result.a?.reasons).toEqual([
      "6 points in old exams",
      "Tested by 1 Exercise",
    ]);
    expect(result.c?.reasons).toEqual(["1 KC builds on it"]);
  });

  test("without exam points, weigh Exercises and dependents half each", () => {
    const result = byKc(
      course({
        exercises: [{ questionChunk: "l1", kcs: ["a"] }],
        prerequisites: [{ from: "b", to: "a" }],
      }),
    );
    expect(result.a?.priority).toBe(0.5);
    expect(result.b?.priority).toBe(0.5);
    expect(result.a?.multiplier).toBe(1);
  });

  test("exclude a non-prior KC taught only by excluded Materials", () => {
    const input = course({
      kcs: [
        { id: "a", prior: false, sources: ["l1", "l3"] },
        { id: "b", prior: false, sources: ["l1", "e1"] },
        { id: "c", prior: true, sources: ["l1"] },
      ],
      exercises: [{ questionChunk: "l1", kcs: ["a", "b", "c"] }],
    });
    const result = byKc(input, ["lecture", "sheet"]);
    expect(result.a).toMatchObject({
      priority: 0,
      multiplier: 0,
      reasons: ["Excluded: you skip Lecture, Sheet 1"],
    });
    expect(result.b?.multiplier).toBe(1);
    expect(result.c?.multiplier).toBe(1);
  });
});

describe("priority levels", () => {
  test("split the KCs above 0 into tertiles; ×0 is excluded, other 0s low", () => {
    const levels = priorityLevels([
      ...[0.9, 0.8, 0.5, 0.4, 0.2, 0.1].map((priority, index) => ({
        kcId: `k${index}`,
        priority,
        multiplier: 1,
      })),
      { kcId: "unused", priority: 0, multiplier: 1 },
      { kcId: "skipped", priority: 0, multiplier: 0 },
    ]);
    expect([...levels.values()]).toEqual([
      "high",
      "high",
      "medium",
      "medium",
      "low",
      "low",
      "low",
      "excluded",
    ]);
  });

  test.each([
    ["priority 0 with multiplier 1", "low", 0, 1],
    ["a lone positive priority", "high", 0.3, 1],
    ["multiplier 0 with a priority", "excluded", 0.3, 0],
  ])("give %s the level %s", (_, level, priority, multiplier) => {
    const levels = priorityLevels([{ kcId: "a", priority, multiplier }]);
    expect(levels.get("a")).toBe(level);
  });

  test("give equal priorities one level", () => {
    const levels = priorityLevels([
      { kcId: "a", priority: 0.5, multiplier: 1 },
      { kcId: "b", priority: 0.5, multiplier: 1 },
      { kcId: "c", priority: 0.1, multiplier: 1 },
    ]);
    expect(Object.fromEntries(levels)).toEqual({
      a: "high",
      b: "high",
      c: "low",
    });
  });
});
