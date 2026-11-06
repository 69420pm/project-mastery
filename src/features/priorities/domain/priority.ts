/**
 * The Priority of each KC of a Course for the Student's exam, computed when
 * read from old exams, Exercises and what the Brief excludes or stresses:
 *
 *   Priority = scope × (0.25 + 0.5 × oldExamShare + 0.25 × exerciseShare)
 *
 * Then a KC is at least as important as any KC that builds on it, directly
 * or not, unless its own scope factor is 0.
 *
 * Pure code; `server/priorities.ts` feeds it the stored map and Brief.
 */

/** A KC as Priority reads it. */
type PriorityKc = {
  id: string;
  name: string;
  /** The ids of the KCs it builds on, its Prerequisites. */
  prerequisites: string[];
  /**
   * The Topic that holds it, then that Topic's ancestors up to the top;
   * empty when no Topic holds it.
   */
  topics: string[];
  /** The chunks that teach it. */
  sources: string[];
};

/** A Student-confirmed statement about one Topic and its subtree. */
export type ExamScope = {
  topicId: string;
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
  materials: Record<string, { name: string }>;
  /** The chunks in an old exam: their Chapter or one above it is one. */
  examChunkIds: string[];
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
  const examChunks = new Set(input.examChunkIds);
  for (const exercise of input.exercises) {
    const oldExam = examChunks.has(exercise.questionChunk);
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
 * excluded Materials, else its Topic's exam scope, else the nearest one up
 * its Topic's ancestors.
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
  const scope = kc.topics
    .map((topicId) => input.examScopes.find((s) => s.topicId === topicId))
    .find((found) => found !== undefined);
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
  type Own = { priority: number; excluded: boolean; reasons: string[] };
  const own = new Map<string, Own>(
    input.kcs.map((kc) => {
      const count = counts.get(kc.id) ?? { exercises: 0, oldExam: 0 };
      const scope = scopeOf(kc, input, excluded);
      const oldExamShare = maxOldExam > 0 ? count.oldExam / maxOldExam : 0;
      const exerciseShare =
        maxExercises > 0 ? count.exercises / maxExercises : 0;
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
      return [
        kc.id,
        {
          priority:
            scope.factor * (0.25 + 0.5 * oldExamShare + 0.25 * exerciseShare),
          excluded: scope.factor === 0,
          reasons,
        },
      ];
    }),
  );
  const dependents = new Map<string, PriorityKc[]>();
  for (const kc of input.kcs) {
    for (const id of kc.prerequisites) {
      dependents.set(id, [...(dependents.get(id) ?? []), kc]);
    }
  }
  const done = new Map<string, { priority: number; reasons: string[] }>();
  const resolve = (
    kc: PriorityKc,
    visiting: Set<string>,
  ): { priority: number; reasons: string[] } => {
    const known = done.get(kc.id);
    if (known) return known;
    const mine = own.get(kc.id) as Own;
    let best = { priority: 0, from: null as PriorityKc | null };
    visiting.add(kc.id);
    for (const dependent of dependents.get(kc.id) ?? []) {
      if (visiting.has(dependent.id)) continue;
      const { priority } = resolve(dependent, visiting);
      if (priority > best.priority) best = { priority, from: dependent };
    }
    visiting.delete(kc.id);
    let result = { priority: mine.priority, reasons: mine.reasons };
    if (mine.excluded) {
      // The Student confirmed it: stays at 0.
    } else if (best.from && best.priority > mine.priority) {
      result = {
        priority: best.priority,
        reasons: [...mine.reasons, `Needed for ${best.from.name}`],
      };
    }
    done.set(kc.id, result);
    return result;
  };
  const values = input.kcs.map((kc) => ({
    kcId: kc.id,
    ...resolve(kc, new Set()),
  }));
  const levels = levelsOf(values);
  return values.map((value) => ({
    ...value,
    level: levels.get(value.kcId) ?? "low",
  }));
}
