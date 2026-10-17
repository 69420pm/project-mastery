import type { MapAttempt, MapKcLearning } from "@/features/knowledge-map/types";

/** What the map page's panels count and list about Exercises and Big ideas. */

export type KcState = MapKcLearning[string]["state"];

export const KC_STATES: KcState[] = ["new", "learning", "due", "mastered"];

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

/** How many of `kcIds` are in each KC state; a KC without learning is new. */
export function stateCounts(
  kcIds: string[],
  learning: MapKcLearning,
): Record<KcState, number> {
  const counts: Record<KcState, number> = {
    new: 0,
    learning: 0,
    due: 0,
    mastered: 0,
  };
  for (const id of kcIds) counts[learning[id]?.state ?? "new"] += 1;
  return counts;
}
