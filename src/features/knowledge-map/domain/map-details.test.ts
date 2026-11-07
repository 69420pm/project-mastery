import { expect, test } from "vitest";
import type { MapAttempt, MapKcLearning } from "@/features/knowledge-map/types";
import { attemptedExercises, exerciseAttempts } from "./map-details";

const attempt = (createdAt: string, exerciseId: string | null): MapAttempt => ({
  createdAt,
  result: "full",
  help: "none",
  exerciseId,
});

const entry = (attempts: MapAttempt[]): MapKcLearning[string] => ({
  band: "fading",
  recallToday: null,
  nextReview: null,
  attempts,
});

const learning: MapKcLearning = {
  k1: entry([attempt("2026-10-02", "e1"), attempt("2026-10-01", null)]),
  k2: entry([attempt("2026-10-03", "e1"), attempt("2026-10-01", "e2")]),
};

test("an Exercise's attempts, newest first, one per KC", () => {
  expect(
    exerciseAttempts("e1", learning).map((a) => [a.createdAt, a.kcId]),
  ).toEqual([
    ["2026-10-03", "k2"],
    ["2026-10-02", "k1"],
  ]);
  expect([...attemptedExercises(learning)].toSorted()).toEqual(["e1", "e2"]);
});
