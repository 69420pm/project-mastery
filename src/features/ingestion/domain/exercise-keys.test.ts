import { expect, test } from "vitest";
import {
  exerciseKeys,
  normalizeExerciseNumber,
  rootKey,
} from "@/features/ingestion/domain/exercise-keys";
import type { ChunkLabel } from "@/features/ingestion/types";

const chunk = (label: ChunkLabel, exerciseNumber: string | null) => ({
  label,
  exerciseNumber,
});

test("a number without a digit keys under the nearest preceding number of its label, on both sides", () => {
  expect(
    exerciseKeys([
      chunk("exercise", "Aufgabe 7.2"),
      chunk("exercise", "a)"),
      chunk("solution", "Lösung zu 7.2 a)"),
      chunk("exercise", "b)"),
      chunk("solution", "(b)"),
      chunk("content", null),
    ]),
  ).toEqual(["7.2", "7.2.a", "7.2.a", "7.2.b", "7.2.b", null]);
});

test("without a preceding number of its label, the key is null", () => {
  expect(
    exerciseKeys([chunk("solution", "3"), chunk("exercise", "b)")]),
  ).toEqual(["3", null]);
});

test("a number is read the same however it is printed", () => {
  expect(normalizeExerciseNumber("Aufgabe 7.2 b)")).toBe("7.2.b");
  expect(normalizeExerciseNumber("Lösung zu 7.2(b)")).toBe("7.2.b");
  expect(normalizeExerciseNumber("Exercise 7.2 B")).toBe("7.2.b");
  expect(normalizeExerciseNumber("Task 03")).toBe("3");
  expect(normalizeExerciseNumber("Teil b")).toBeNull();
});

test("the root of a key is its leading numbers", () => {
  expect(rootKey("7.2.b")).toBe("7.2");
  expect(rootKey("3")).toBe("3");
  expect(rootKey(null)).toBeNull();
});
