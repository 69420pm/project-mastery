import { describe, expect, test } from "vitest";
import {
  exerciseSubtasks,
  normalizeExerciseNumber,
  pairByNumber,
} from "./exercise-pairing";

describe("normalizeExerciseNumber", () => {
  test("reads a subtask the same however it is printed", () => {
    expect(normalizeExerciseNumber("7.2b")).toBe("7.2.b");
    expect(normalizeExerciseNumber("Aufgabe 7.2 b)")).toBe("7.2.b");
    expect(normalizeExerciseNumber("Lösung zu 7.2(b)")).toBe("7.2.b");
    expect(normalizeExerciseNumber("Exercise 7.2 B")).toBe("7.2.b");
  });

  test("drops leading zeros", () => {
    expect(normalizeExerciseNumber("Task 03")).toBe("3");
  });

  test("is null without a number", () => {
    expect(normalizeExerciseNumber("Teil b")).toBeNull();
    expect(normalizeExerciseNumber(null)).toBeNull();
  });
});

const chunk = (
  id: string,
  exerciseNumber: string | null,
  materialId = "m1",
) => ({
  id,
  materialId,
  exerciseNumber,
});

describe("pairByNumber", () => {
  test("pairs exercises with solutions in another Material by number", () => {
    const result = pairByNumber(
      [chunk("e1", "7.2a"), chunk("e2", "Aufgabe 7.2 b)")],
      [chunk("s2", "7.2b", "m2"), chunk("s1", "Lösung 7.2 a)", "m2")],
    );
    expect(result).toEqual({
      pairs: [
        { exerciseId: "e1", solutionId: "s1" },
        { exerciseId: "e2", solutionId: "s2" },
      ],
      unpairedExercises: [],
      unpairedSolutions: [],
    });
  });

  test("leaves exercises and solutions without a matching number", () => {
    const result = pairByNumber(
      [chunk("e1", "1"), chunk("e2", null)],
      [chunk("s1", "2", "m2")],
    );
    expect(result).toEqual({
      pairs: [],
      unpairedExercises: [chunk("e1", "1"), chunk("e2", null)],
      unpairedSolutions: [chunk("s1", "2", "m2")],
    });
  });

  test("leaves a number that two sheets share for the content call", () => {
    const result = pairByNumber(
      [chunk("e1", "1a", "sheet1"), chunk("e2", "1a", "sheet2")],
      [chunk("s1", "1a", "solutions1")],
    );
    expect(result.pairs).toEqual([]);
    expect(result.unpairedExercises.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(result.unpairedSolutions.map((s) => s.id)).toEqual(["s1"]);
  });

  test("pairs subtasks with the solution of their whole exercise", () => {
    const result = pairByNumber(
      [chunk("e1", "3a"), chunk("e2", "3b")],
      [chunk("s1", "Aufgabe 3", "m2")],
    );
    expect(result.pairs).toEqual([
      { exerciseId: "e1", solutionId: "s1" },
      { exerciseId: "e2", solutionId: "s1" },
    ]);
    expect(result.unpairedSolutions).toEqual([]);
  });
});

describe("exerciseSubtasks", () => {
  test("leaves out a statement its Material splits into subtasks", () => {
    const subtasks = exerciseSubtasks([
      chunk("stem", "7.2"),
      chunk("e1", "7.2a"),
      chunk("e2", "7.2b"),
      chunk("e3", "7.3"),
      chunk("other", "7.2", "m2"),
    ]);
    expect(subtasks.map((e) => e.id)).toEqual(["e1", "e2", "e3", "other"]);
  });
});
