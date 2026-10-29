/**
 * The Priority of each KC of a Course for the Student's exam (#86): a base
 * from old exams, Exercises and the prerequisite graph, times a multiplier.
 * Pure code; the `updatePriorities` workflow feeds it the stored map.
 */

/** A KC as the base reads it. */
type PriorityKc = {
  id: string;
  /** The chunks that teach it. */
  sources: string[];
};

/** What the base is computed from. */
export type PriorityInput = {
  kcs: PriorityKc[];
  /** `from` must be learned before `to`. */
  prerequisites: Array<{ from: string; to: string }>;
  exercises: Array<{ questionChunk: string; kcs: string[] }>;
  /** The Course's chunks by id: their Material and printed points. */
  chunks: Record<string, { materialId: string; points: number | null }>;
  /** The Course's Materials by id. */
  materials: Record<string, { name: string; isExam: boolean }>;
};

/** A KC's three base factors, each from 0 to 1, with the raw counts. */
export type BaseFactors = {
  exam: number;
  exercises: number;
  dependents: number;
  examPoints: number;
  exerciseCount: number;
  dependentCount: number;
};

/** A KC's stored Priority. */
export type KcPriority = {
  kcId: string;
  priority: number;
  multiplier: number;
  reasons: string[];
};

/** Each value divided by the largest; all 0 when the largest is 0. */
function normalized(values: Map<string, number>): Map<string, number> {
  const max = Math.max(0, ...values.values());
  return new Map(
    [...values].map(([id, value]) => [id, max > 0 ? value / max : 0]),
  );
}

/** For each KC, how many KCs need it directly or through Prerequisites. */
function dependentCounts(
  kcIds: string[],
  prerequisites: PriorityInput["prerequisites"],
): Map<string, number> {
  const next = new Map<string, string[]>();
  for (const { from, to } of prerequisites) {
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  return new Map(
    kcIds.map((id) => {
      const seen = new Set<string>();
      const stack = [...(next.get(id) ?? [])];
      while (stack.length > 0) {
        const kc = stack.pop() as string;
        if (kc === id || seen.has(kc)) continue;
        seen.add(kc);
        stack.push(...(next.get(kc) ?? []));
      }
      return [id, seen.size];
    }),
  );
}

/**
 * Each KC's points in old exams: an Exercise counts when its question chunk
 * has points and belongs to an exam Material, and its points are split
 * equally across its KCs.
 */
function examPoints(input: PriorityInput): Map<string, number> {
  const points = new Map(input.kcs.map((kc) => [kc.id, 0]));
  for (const exercise of input.exercises) {
    const chunk = input.chunks[exercise.questionChunk];
    const kcs = [...new Set(exercise.kcs)].filter((id) => points.has(id));
    if (chunk?.points == null || kcs.length === 0) continue;
    if (!input.materials[chunk.materialId]?.isExam) continue;
    for (const id of kcs) {
      points.set(id, (points.get(id) ?? 0) + chunk.points / kcs.length);
    }
  }
  return points;
}

/** Each KC's base factors. */
export function baseFactors(input: PriorityInput): Map<string, BaseFactors> {
  const ids = input.kcs.map((kc) => kc.id);
  const points = examPoints(input);
  const counts = new Map(ids.map((id) => [id, 0]));
  for (const exercise of input.exercises) {
    for (const id of new Set(exercise.kcs)) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const dependents = dependentCounts(ids, input.prerequisites);
  const exam = normalized(points);
  const exercises = normalized(counts);
  const graph = normalized(dependents);
  return new Map(
    ids.map((id) => [
      id,
      {
        exam: exam.get(id) ?? 0,
        exercises: exercises.get(id) ?? 0,
        dependents: graph.get(id) ?? 0,
        examPoints: points.get(id) ?? 0,
        exerciseCount: counts.get(id) ?? 0,
        dependentCount: dependents.get(id) ?? 0,
      },
    ]),
  );
}

/**
 * The base: `0.5 · exam + 0.25 · exercises + 0.25 · dependents`, or
 * `0.5 · exercises + 0.5 · dependents` when the Course has no exam points.
 */
function baseOf(factors: BaseFactors, hasExamPoints: boolean): number {
  return hasExamPoints
    ? 0.5 * factors.exam + 0.25 * factors.exercises + 0.25 * factors.dependents
    : 0.5 * factors.exercises + 0.5 * factors.dependents;
}

/**
 * The code exclusion: a KC whose source chunks all belong to
 * Materials the Brief excludes gets ×0, with the reason naming them. Null
 * for any other KC.
 */
function exclusionOf(
  kc: PriorityKc,
  input: Pick<PriorityInput, "chunks" | "materials">,
  excludedMaterialIds: ReadonlySet<string>,
): { multiplier: 0; reason: string } | null {
  if (kc.sources.length === 0) return null;
  const materialIds = kc.sources.map(
    (id) => input.chunks[id]?.materialId ?? "",
  );
  if (!materialIds.every((id) => excludedMaterialIds.has(id))) return null;
  const names = [...new Set(materialIds)]
    .map((id) => input.materials[id]?.name ?? "a Material")
    .toSorted();
  return { multiplier: 0, reason: `Excluded: you skip ${names.join(", ")}` };
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Why the base is what it is, one line per factor that counts. */
function baseReasons(factors: BaseFactors): string[] {
  const points = Math.round(factors.examPoints * 10) / 10;
  return [
    points > 0 && `${plural(points, "point", "points")} in old exams`,
    factors.exerciseCount > 0 &&
      `Tested by ${plural(factors.exerciseCount, "Exercise", "Exercises")}`,
    factors.dependentCount > 0 &&
      `${plural(factors.dependentCount, "KC builds", "KCs build")} on it`,
  ].filter((reason) => reason !== false);
}

/**
 * Every KC's Priority: base × multiplier, where the multiplier is the code
 * exclusion times `adjust` (1 when the model did not adjust it), with the
 * adjustment's reasons after the base's.
 */
export function priorities(
  input: PriorityInput,
  excludedMaterialIds: ReadonlySet<string>,
  adjust: (kcId: string) => { multiplier: number; reasons: string[] } = () => ({
    multiplier: 1,
    reasons: [],
  }),
): KcPriority[] {
  const factors = baseFactors(input);
  const hasExamPoints = [...factors.values()].some((f) => f.examPoints > 0);
  return input.kcs.map((kc) => {
    const kcFactors = factors.get(kc.id) as BaseFactors;
    const excluded = exclusionOf(kc, input, excludedMaterialIds);
    const adjustment = adjust(kc.id);
    const multiplier = (excluded?.multiplier ?? 1) * adjustment.multiplier;
    return {
      kcId: kc.id,
      priority: baseOf(kcFactors, hasExamPoints) * multiplier,
      multiplier,
      reasons: excluded
        ? [excluded.reason]
        : [...baseReasons(kcFactors), ...adjustment.reasons],
    };
  });
}

export type PriorityLevel = "high" | "medium" | "low" | "excluded";

/**
 * The map page's badge per KC: "high", "medium" or "low" by tertiles of
 * priority among the KCs above 0, "excluded" when its multiplier is 0, and
 * "low" for any other KC at 0, such as one no exam, Exercise or KC needs.
 * Equal priorities get the same level: a KC's level follows how many KCs
 * rank strictly above it.
 */
export function priorityLevels(
  values: Array<{ kcId: string; priority: number; multiplier: number }>,
): Map<string, PriorityLevel> {
  const positive = values.filter((value) => value.priority > 0);
  return new Map(
    values.map(({ kcId, priority, multiplier }) => {
      if (multiplier <= 0) return [kcId, "excluded"];
      if (priority <= 0) return [kcId, "low"];
      const above = positive.filter((other) => other.priority > priority);
      const share = above.length / positive.length;
      return [kcId, share < 1 / 3 ? "high" : share < 2 / 3 ? "medium" : "low"];
    }),
  );
}
