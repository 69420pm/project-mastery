import { expect, test } from "vitest";
import type { MapAttempt, MapKcLearning } from "@/features/knowledge-map/types";
import {
  attemptedExercises,
  exerciseAttempts,
  stateCounts,
} from "./map-details";

const attempt = (createdAt: string, exerciseId: string | null): MapAttempt => ({
  createdAt,
  correct: true,
  help: "none",
  exerciseId,
});

const entry = (
  state: MapKcLearning[string]["state"],
  attempts: MapAttempt[],
): MapKcLearning[string] => ({
  state,
  level: 1,
  nextReview: null,
  attempts,
  candidate: false,
  anchors: [],
});

const learning: MapKcLearning = {
  k1: entry("learning", [
    attempt("2026-10-02", "e1"),
    attempt("2026-10-01", null),
  ]),
  k2: entry("due", [attempt("2026-10-03", "e1"), attempt("2026-10-01", "e2")]),
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

test("counts KCs per state, a KC without learning as new", () => {
  expect(stateCounts(["k1", "k2", "k3"], learning)).toEqual({
    new: 1,
    learning: 1,
    due: 1,
    known: 0,
  });
});
