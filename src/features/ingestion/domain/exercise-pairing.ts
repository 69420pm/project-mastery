/**
 * Pairing exercises with their solutions across a Course (step 5 of a
 * parse), the part done in code: by normalized number first. What is left
 * goes to the content call, and what that leaves has no solution.
 */

/**
 * An exercise number as a comparable key: what comes before its first digit
 * ("Aufgabe", "Lösung zu") is dropped, and the rest is read as its numbers
 * and letters, so "7.2b" and "Aufgabe 7.2 b)" are both "7.2.b". Null
 * without a number.
 */
export function normalizeExerciseNumber(number: string | null): string | null {
  if (number === null) return null;
  const text = number.normalize("NFKC").toLowerCase();
  const firstDigit = text.search(/\d/);
  if (firstDigit === -1) return null;
  const parts = text.slice(firstDigit).match(/\d+|\p{L}+/gu) ?? [];
  return parts
    .map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part))
    .join(".");
}

/** An exercise or solution chunk of a Course, as pairing sees it. */
export type PairingChunk = {
  id: string;
  materialId: string;
  /** As printed, such as "7.2a". */
  exerciseNumber: string | null;
};

export type ExercisePair = { exerciseId: string; solutionId: string };

export type NumberPairing = {
  pairs: ExercisePair[];
  /** For the content call, in the given order. */
  unpairedExercises: PairingChunk[];
  unpairedSolutions: PairingChunk[];
};

/** Whether `key` is a strict ancestor of `other`, such as 7.2 of 7.2.b. */
function isAncestor(key: string, other: string): boolean {
  return other.startsWith(`${key}.`);
}

/**
 * The exercise subtasks, which pairing gives a solution or "no solution":
 * an exercise's statement shared by its subtasks (7.2, split into 7.2a and
 * 7.2b in the same Material) is left out.
 */
export function exerciseSubtasks(exercises: PairingChunk[]): PairingChunk[] {
  return exercises.filter((exercise) => {
    const key = normalizeExerciseNumber(exercise.exerciseNumber);
    if (key === null) return true;
    return !exercises.some((other) => {
      const otherKey = normalizeExerciseNumber(other.exerciseNumber);
      return (
        other.materialId === exercise.materialId &&
        otherKey !== null &&
        isAncestor(key, otherKey)
      );
    });
  });
}

/** The chunks by normalized number; chunks without one are left out. */
function byNumber(chunks: PairingChunk[]): Map<string, PairingChunk[]> {
  const groups = new Map<string, PairingChunk[]>();
  for (const chunk of chunks) {
    const key = normalizeExerciseNumber(chunk.exerciseNumber);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), chunk]);
  }
  return groups;
}

/**
 * Pairs each exercise whose normalized number is unique among the
 * exercises with the one solution of that number, or else of its nearest
 * whole exercise (3a with the solution to 3). A number that several
 * exercises or solutions share, such as "1" on every sheet, is left
 * ambiguous for the content call, like numbers without a match.
 */
export function pairByNumber(
  exercises: PairingChunk[],
  solutions: PairingChunk[],
): NumberPairing {
  const exerciseGroups = byNumber(exercises);
  const solutionGroups = byNumber(solutions);
  const onlySolution = (key: string) => {
    const group = solutionGroups.get(key);
    return group?.length === 1 ? group[0] : undefined;
  };

  const pairs: ExercisePair[] = [];
  const usedSolutions = new Set<string>();
  const unpairedExercises: PairingChunk[] = [];
  for (const exercise of exercises) {
    const key = normalizeExerciseNumber(exercise.exerciseNumber);
    const solution =
      key !== null && exerciseGroups.get(key)?.length === 1
        ? solutionFor(key, onlySolution)
        : undefined;
    if (solution) {
      pairs.push({ exerciseId: exercise.id, solutionId: solution.id });
      usedSolutions.add(solution.id);
    } else {
      unpairedExercises.push(exercise);
    }
  }
  return {
    pairs,
    unpairedExercises,
    unpairedSolutions: solutions.filter(
      (solution) => !usedSolutions.has(solution.id),
    ),
  };
}

/** The only solution of `key`, or else of its nearest ancestor. */
function solutionFor(
  key: string,
  onlySolution: (key: string) => PairingChunk | undefined,
): PairingChunk | undefined {
  const parts = key.split(".");
  for (let length = parts.length; length > 0; length--) {
    const solution = onlySolution(parts.slice(0, length).join("."));
    if (solution) return solution;
  }
  return undefined;
}
