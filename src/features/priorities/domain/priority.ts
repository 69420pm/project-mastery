/**
 * The Priority of each KC of a Course for the Student's exam, computed when
 * read from old exams, Exercises and what the Brief excludes or stresses:
 *
 *   Priority = scope × (0.25 + 0.5 × oldExamShare + 0.25 × exerciseShare)
 *
 * Pure code; `server/priorities.ts` feeds it the stored map and Brief.
 */

/** A KC as Priority reads it. */
type PriorityKc = {
  id: string;
  bigIdeaId: string;
  /** Null when no Topic holds it. */
  topicId: string | null;
  /** The chunks that teach it. */
  sources: string[];
};

/** A Student-confirmed statement about one Big idea or Topic. */
export type ExamScope = {
  bigIdeaId: string | null;
  topicId: string | null;
  scope: "excluded" | "emphasized";
  words: string;
};

/** What Priority is computed from. */
export type PriorityInput = {
  kcs: PriorityKc[];
  exercises: Array<{ questionChunk: string; kcs: string[] }>;
  /** Each chunk's Material by chunk id. */
  chunkMaterials: Record<string, string>;
  /** The Course's Materials by id. */
  materials: Record<string, { name: string; isExam: boolean }>;
  /** The Materials the Brief excludes. */
  excludedMaterialIds: string[];
  examScopes: ExamScope[];
};

export type PriorityLevel = "high" | "medium" | "low" | "excluded";

/** A KC's Priority with the map page's level and reasons. */
export type KcPriority = {
  kcId: string;
  priority: number;
  level: PriorityLevel;
  reasons: string[];
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** How many Exercises, and old-exam Exercises, test each KC. */
function exerciseCounts(input: PriorityInput) {
  const counts = new Map(
    input.kcs.map((kc) => [kc.id, { exercises: 0, oldExam: 0 }]),
  );
  for (const exercise of input.exercises) {
    const material = input.chunkMaterials[exercise.questionChunk];
    const oldExam = material !== undefined && input.materials[material]?.isExam;
    for (const id of new Set(exercise.kcs)) {
      const count = counts.get(id);
      if (!count) continue;
      count.exercises += 1;
      if (oldExam) count.oldExam += 1;
    }
  }
  return counts;
}

/**
 * A KC's scope factor and its reason: 0 when all its sources are in
 * excluded Materials, else its Topic's exam scope, else its Big idea's.
 */
function scopeOf(
  kc: PriorityKc,
  input: PriorityInput,
  excluded: ReadonlySet<string>,
): { factor: number; reason: string | null } {
  const materials = kc.sources.map((id) => input.chunkMaterials[id] ?? "");
  if (materials.length > 0 && materials.every((id) => excluded.has(id))) {
    const names = [...new Set(materials)]
      .map((id) => input.materials[id]?.name ?? "a Material")
      .toSorted();
    return { factor: 0, reason: `Excluded: you skip ${names.join(", ")}` };
  }
  const scope =
    input.examScopes.find(
      (s) => kc.topicId !== null && s.topicId === kc.topicId,
    ) ?? input.examScopes.find((s) => s.bigIdeaId === kc.bigIdeaId);
  if (!scope) return { factor: 1, reason: null };
  return scope.scope === "excluded"
    ? { factor: 0, reason: `Excluded in the Brief: ${scope.words}` }
    : { factor: 2, reason: `Emphasized in the Brief: ${scope.words}` };
}

/**
 * The map page's level per KC: "excluded" at Priority 0, else "high",
 * "medium" or "low" by tertiles of the other KCs. Equal priorities get the
 * same level: a KC's level follows how many KCs rank strictly above it.
 */
function levelsOf(values: Array<{ kcId: string; priority: number }>) {
  const ranked = values.filter((value) => value.priority > 0);
  return new Map<string, PriorityLevel>(
    values.map(({ kcId, priority }) => {
      if (priority <= 0) return [kcId, "excluded"];
      const above = ranked.filter((other) => other.priority > priority);
      const share = above.length / ranked.length;
      return [kcId, share < 1 / 3 ? "high" : share < 2 / 3 ? "medium" : "low"];
    }),
  );
}

/** Every KC's Priority, level and reasons, in the order of `input.kcs`. */
export function kcPriorities(input: PriorityInput): KcPriority[] {
  const counts = exerciseCounts(input);
  const maxOldExam = Math.max(0, ...[...counts.values()].map((c) => c.oldExam));
  const maxExercises = Math.max(
    0,
    ...[...counts.values()].map((c) => c.exercises),
  );
  const excluded = new Set(input.excludedMaterialIds);
  const values = input.kcs.map((kc) => {
    const count = counts.get(kc.id) ?? { exercises: 0, oldExam: 0 };
    const scope = scopeOf(kc, input, excluded);
    const oldExamShare = maxOldExam > 0 ? count.oldExam / maxOldExam : 0;
    const exerciseShare = maxExercises > 0 ? count.exercises / maxExercises : 0;
    const reasons =
      scope.factor === 0
        ? [scope.reason as string]
        : [
            count.oldExam > 0 &&
              `Tested in ${plural(count.oldExam, "old-exam Exercise", "old-exam Exercises")}`,
            count.exercises > 0 &&
              `Tested in ${plural(count.exercises, "Exercise", "Exercises")}`,
            scope.reason,
          ].filter((reason) => typeof reason === "string");
    return {
      kcId: kc.id,
      priority:
        scope.factor * (0.25 + 0.5 * oldExamShare + 0.25 * exerciseShare),
      reasons,
    };
  });
  const levels = levelsOf(values);
  return values.map((value) => ({
    ...value,
    level: levels.get(value.kcId) ?? "low",
  }));
}
