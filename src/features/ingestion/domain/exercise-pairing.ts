import { exerciseKeys } from "@/features/ingestion/domain/exercise-keys";

/**
 * Pairing exercises with their solutions across a Course, the part done in
 * code (#223): within each Material by key and position, then between
 * partner Materials by key, then the shortlists of what is left for the
 * content call. Keys come from `exerciseKeys`, per Material.
 */

/** An exercise or solution chunk of a Course, as pairing sees it. */
export type PairingChunk = {
  id: string;
  materialId: string;
  label: "exercise" | "solution";
  /** As printed, such as "7.2a". */
  exerciseNumber: string | null;
  /** Its key in its Material, such as 7.2.a, or null. */
  key: string | null;
};

/** A Material of the Course with its exercise and solution chunks. */
export type PairingMaterial = {
  id: string;
  name: string;
  /** In reading order. */
  chunks: Array<Pick<PairingChunk, "id" | "label" | "exerciseNumber">>;
};

export type ExercisePair = { exerciseId: string; solutionId: string };

/** Partner Materials of each Material, by id. */
export type Partners = Map<string, Set<string>>;

/**
 * The Course's chunks with their keys: Materials in the given order (by
 * upload), each Material's chunks in reading order.
 */
export function keyedChunks(materials: PairingMaterial[]): PairingChunk[] {
  return materials.flatMap((material) => {
    const keys = exerciseKeys(material.chunks);
    return material.chunks.map((chunk, index) => ({
      ...chunk,
      materialId: material.id,
      key: keys[index] ?? null,
    }));
  });
}

/** Whether `key` is a strict ancestor of `other`, such as 7.2 of 7.2.b. */
function isAncestor(key: string, other: string): boolean {
  return other.startsWith(`${key}.`);
}

/** A key and its ancestors, nearest first: 7.2.b, 7.2, 7. */
function keyAndAncestors(key: string): string[] {
  const segments = key.split(".");
  return segments.map((_, index) =>
    segments.slice(0, segments.length - index).join("."),
  );
}

/** Whether `other` is `key` or one of its ancestors. */
function fitsKey(key: string, other: string): boolean {
  return other === key || isAncestor(other, key);
}

/**
 * The exercise subtasks, which pairing gives a solution or "no solution":
 * an exercise's statement shared by its subtasks is left out. A statement is
 * an exercise whose Material's next exercise has a key under its key, as
 * 7.2.a follows 7.2; so a Resit's Problem 2 stays a subtask after a Final
 * whose Problem 2 has parts.
 */
export function exerciseSubtasks(chunks: PairingChunk[]): PairingChunk[] {
  const exercises = chunks.filter((chunk) => chunk.label === "exercise");
  return exercises.filter((exercise, index) => {
    const next = exercises[index + 1];
    return !(
      exercise.key !== null &&
      next?.materialId === exercise.materialId &&
      next.key !== null &&
      isAncestor(exercise.key, next.key)
    );
  });
}

/** Words a solution Material's name adds to its exercises' name. */
const SOLUTION_WORDS = new Set([
  "lösung",
  "loesung",
  "lsg",
  "musterlösung",
  "solution",
  "solutions",
  "sol",
]);

/**
 * A Material's name without case, punctuation and the solution words, so
 * "Blatt 3 – Lösung.pdf" and "Blatt 3.pdf" are both "blatt 3 pdf".
 */
export function nameStem(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !SOLUTION_WORDS.has(word))
    .join(" ");
}

/** Share of exercise keys a solution Material must cover to be a partner. */
const PARTNER_COVERAGE = 0.8;

/**
 * Partner Materials: two Materials whose names have the same stem. A
 * Material with solutions, no exercises and no partner by name is the
 * partner of the one other Material whose exercise subtask keys its
 * solution keys cover (the key or an ancestor) for at least 80%, when
 * exactly one does.
 */
export function partnerMaterials(
  materials: PairingMaterial[],
  chunks: PairingChunk[],
): Partners {
  const partners: Partners = new Map(
    materials.map((material) => [material.id, new Set<string>()]),
  );
  const link = (a: string, b: string) => {
    partners.get(a)?.add(b);
    partners.get(b)?.add(a);
  };
  materials.forEach((material, index) => {
    const stem = nameStem(material.name);
    if (stem === "") return;
    for (const other of materials.slice(index + 1)) {
      if (nameStem(other.name) === stem) link(material.id, other.id);
    }
  });

  const subtaskKeys = new Map<string, Set<string>>();
  for (const exercise of exerciseSubtasks(chunks)) {
    if (exercise.key === null) continue;
    const keys = subtaskKeys.get(exercise.materialId) ?? new Set();
    subtaskKeys.set(exercise.materialId, keys.add(exercise.key));
  }
  for (const material of materials) {
    const own = chunks.filter((chunk) => chunk.materialId === material.id);
    const solutionKeys = own.flatMap((chunk) =>
      chunk.label === "solution" && chunk.key !== null ? [chunk.key] : [],
    );
    if (
      partners.get(material.id)!.size > 0 ||
      own.some((chunk) => chunk.label === "exercise") ||
      solutionKeys.length === 0
    ) {
      continue;
    }
    const covering = [...subtaskKeys].filter(([materialId, keys]) => {
      if (materialId === material.id) return false;
      const covered = [...keys].filter((key) =>
        solutionKeys.some((solutionKey) => fitsKey(key, solutionKey)),
      );
      return covered.length >= PARTNER_COVERAGE * keys.size;
    });
    if (covering.length === 1) link(material.id, covering[0]![0]);
  }
  return partners;
}

/**
 * The one solution with the exercise's key, or else with its nearest
 * ancestor key that any solution has; undefined when that key has several.
 */
function onlyByNearestKey(
  key: string,
  solutions: PairingChunk[],
): PairingChunk | undefined {
  for (const candidate of keyAndAncestors(key)) {
    const matching = solutions.filter((solution) => solution.key === candidate);
    if (matching.length > 0) {
      return matching.length === 1 ? matching[0] : undefined;
    }
  }
  return undefined;
}

export type CodePairing = {
  pairs: ExercisePair[];
  /** The exercise subtasks code left, in Course order. */
  exercises: PairingChunk[];
  /** The solutions no pair took, in Course order. */
  solutions: PairingChunk[];
};

/**
 * Pairs what keys decide, without a call.
 *
 * 1. Same Material: an exercise takes the solution with its key, or else its
 *    nearest ancestor key, that comes after it and before the next exercise
 *    with its key or an ancestor key, when exactly one does. So a Final and a Resit that both
 *    number from 1 pair each Problem with its own solution.
 * 2. Partners: an exercise left whose key is unique among its Material's
 *    exercises takes the only solution in its partner Materials with its
 *    key, or else its nearest ancestor key.
 */
export function pairInCode(
  chunks: PairingChunk[],
  partners: Partners,
): CodePairing {
  const pairs: ExercisePair[] = [];
  const exercises: PairingChunk[] = [];
  for (const exercise of exerciseSubtasks(chunks)) {
    const solution =
      exercise.key === null
        ? undefined
        : (inMaterialSolution(exercise, chunks) ??
          partnerSolution(exercise, chunks, partners));
    if (solution) {
      pairs.push({ exerciseId: exercise.id, solutionId: solution.id });
    } else {
      exercises.push(exercise);
    }
  }
  const used = new Set(pairs.map((pair) => pair.solutionId));
  return {
    pairs,
    exercises,
    solutions: chunks.filter(
      (chunk) => chunk.label === "solution" && !used.has(chunk.id),
    ),
  };
}

/** Step 1, for an exercise with a key. */
function inMaterialSolution(
  exercise: PairingChunk,
  chunks: PairingChunk[],
): PairingChunk | undefined {
  const own = chunks.filter(
    (chunk) => chunk.materialId === exercise.materialId,
  );
  const after = own.slice(own.indexOf(exercise) + 1);
  // The next exercise with its key or an ancestor key starts another one,
  // such as the Resit's Problem 2 after the Final's 2a.
  const next = after.findIndex(
    (chunk) =>
      chunk.label === "exercise" &&
      chunk.key !== null &&
      fitsKey(exercise.key!, chunk.key),
  );
  const window = (next === -1 ? after : after.slice(0, next)).filter(
    (chunk) => chunk.label === "solution",
  );
  return onlyByNearestKey(exercise.key!, window);
}

/** Step 2, for an exercise with a key. */
function partnerSolution(
  exercise: PairingChunk,
  chunks: PairingChunk[],
  partners: Partners,
): PairingChunk | undefined {
  const sameKey = chunks.filter(
    (chunk) =>
      chunk.materialId === exercise.materialId &&
      chunk.label === "exercise" &&
      chunk.key === exercise.key,
  );
  if (sameKey.length !== 1) return undefined;
  const ofPartners = partners.get(exercise.materialId) ?? new Set();
  return onlyByNearestKey(
    exercise.key!,
    chunks.filter(
      (chunk) => chunk.label === "solution" && ofPartners.has(chunk.materialId),
    ),
  );
}

/** Cosine similarity below which a solution is not offered. */
export const CANDIDATE_FLOOR = 0.5;
/** Candidates per exercise, and of them at most this many with its key. */
const SHORTLIST_SIZE = 6;
const SAME_KEY_CANDIDATES = 3;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
    normA += a[index]! ** 2;
    normB += b[index]! ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/**
 * The solutions offered to an exercise in the content call: up to 3 with its
 * key (or an ancestor), nearest first, then the nearest of the others, 6 at
 * most, each at cosine 0.5 or more to the exercise's embedding. A solution
 * whose key differs from the exercise's is left out when both come from one
 * Material or from partners, as they share one numbering. Empty when the
 * exercise has no embedding.
 */
export function shortlist(
  exercise: PairingChunk,
  solutions: PairingChunk[],
  partners: Partners,
  embeddings: Map<string, number[]>,
): PairingChunk[] {
  const vector = embeddings.get(exercise.id);
  if (!vector) return [];
  const sharesNumbering = (solution: PairingChunk) =>
    solution.materialId === exercise.materialId ||
    (partners.get(exercise.materialId)?.has(solution.materialId) ?? false);
  const fits = (solution: PairingChunk) =>
    exercise.key !== null &&
    solution.key !== null &&
    fitsKey(exercise.key, solution.key);
  const near = solutions
    .filter(
      (solution) =>
        fits(solution) ||
        solution.key === null ||
        exercise.key === null ||
        !sharesNumbering(solution),
    )
    .flatMap((solution) => {
      const other = embeddings.get(solution.id);
      const similarity = other ? cosine(vector, other) : -1;
      return similarity >= CANDIDATE_FLOOR ? [{ solution, similarity }] : [];
    })
    .toSorted((a, b) => b.similarity - a.similarity)
    .map(({ solution }) => solution);
  const sameKey = near.filter(fits).slice(0, SAME_KEY_CANDIDATES);
  const others = near.filter((solution) => !sameKey.includes(solution));
  return [...sameKey, ...others].slice(0, SHORTLIST_SIZE);
}

/** The exercises of one content call. */
export const BATCH_SIZE = 10;

/** Items in runs of `size`, in order. */
export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}
