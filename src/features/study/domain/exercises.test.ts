import { describe, expect, test } from "vitest";
import {
  generatedSolutionLabel,
  rankProblems,
  solutionLabel,
  targetDifficulty,
  type RankableExercise,
} from "./exercises";

const ex = (
  id: string,
  kcs: string[],
  extra: Partial<RankableExercise> = {},
): RankableExercise => ({
  id,
  kcs,
  difficulty: 2,
  source: "exercise",
  ...extra,
});
const exam = { source: "old_exam" } as const;

const rank = (
  list: RankableExercise[],
  kcIds = ["x"],
  last: string | null = null,
  target = 2,
) => rankProblems(list, kcIds, last, target).map((e) => e.id);

test("solutionLabel tells the AI to solve an Exercise without a printed solution with the Student", () => {
  expect(solutionLabel(true)).toBe("from the Materials");
  expect(solutionLabel(false)).toContain("solve it with the Student");
});

test("generatedSolutionLabel says where a generated Problem's numbers come from", () => {
  expect(generatedSolutionLabel(true)).toContain("computed by code");
  expect(generatedSolutionLabel(false)).toContain("check it before relying");
});

test("targetDifficulty is one above the last success, capped at 3", () => {
  expect(targetDifficulty(null)).toBe(1);
  expect(targetDifficulty(1)).toBe(2);
  expect(targetDifficulty(3)).toBe(3);
});

describe("rankProblems", () => {
  test("keeps only Exercises that test a given KC", () => {
    expect(rank([ex("a", ["x"]), ex("b", ["y"])])).toEqual(["a"]);
  });

  test("1: more given KCs first, even before an old exam", () => {
    const list = [ex("exam", ["x"], exam), ex("both", ["x", "y"])];
    expect(rank(list, ["x", "y"])).toEqual(["both", "exam"]);
  });

  test("2: old-exam, other Exercises, variants, then new Problems", () => {
    const list = [
      ex("new", ["x"], { source: "new" }),
      ex("variant", ["x"], { source: "variant" }),
      ex("a", ["x"]),
      ex("exam", ["x"], exam),
    ];
    expect(rank(list)).toEqual(["exam", "a", "variant"]);
  });

  test("3: a first KC other than the last Problem's first", () => {
    const list = [ex("same", ["x"]), ex("other", ["y", "x"])];
    expect(rank(list, ["x"], "x")).toEqual(["other", "same"]);
    expect(rank(list, ["x"], null)).toEqual(["same", "other"]);
  });

  test("4: difficulty nearer the target first", () => {
    const list = [
      ex("d1", ["x"], { difficulty: 1 }),
      ex("d3", ["x"], { difficulty: 3 }),
      ex("d2", ["x"], { difficulty: 2 }),
    ];
    expect(rank(list, ["x"], null, 3)).toEqual(["d3", "d2", "d1"]);
    expect(rank(list, ["x"], null, 1)).toEqual(["d1", "d2", "d3"]);
  });

  test("5: gives at most 3 and keeps map order on ties", () => {
    const list = ["a", "b", "c", "d"].map((id) => ex(id, ["x"]));
    expect(rank(list)).toEqual(["a", "b", "c"]);
  });

  test("each criterion breaks the ties of the one before", () => {
    const list = [
      ex("far", ["x"], { ...exam, difficulty: 3 }),
      ex("sameKc", ["x"], exam),
      ex("near", ["z", "x"], exam),
    ];
    expect(rank(list, ["x"], "x", 2)).toEqual(["near", "sameKc", "far"]);
  });
});
