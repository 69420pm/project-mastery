import type { MapAttempt, MapKcLearning } from "@/features/knowledge-map/types";

/** What the map page's panels count and list about Exercises. */

/** The ids of the Exercises the Student has attempted. */
export function attemptedExercises(learning: MapKcLearning): Set<string> {
  return new Set(
    Object.values(learning).flatMap((entry) =>
      entry.attempts.flatMap((attempt) => attempt.exerciseId ?? []),
    ),
  );
}

/**
 * The attempts at an Exercise, newest first, one per KC it was graded on,
 * each with that KC's id.
 */
export function exerciseAttempts(
  exerciseId: string,
  learning: MapKcLearning,
): Array<MapAttempt & { kcId: string }> {
  return Object.entries(learning)
    .flatMap(([kcId, entry]) =>
      entry.attempts
        .filter((attempt) => attempt.exerciseId === exerciseId)
        .map((attempt) => ({ ...attempt, kcId })),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}
