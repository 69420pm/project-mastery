import {
  BLOOM_LEVELS,
  type BloomLevel,
  type FinalAnswer,
  type KcType,
  type KnowledgeMap,
  type SolutionStatus,
} from "@/features/knowledge-map/schemas";

/**
 * The Exercises of a Knowledge map build (#70): each exercise subtask's
 * answer from the `exercise` call becomes an Exercise with a solution status
 * and a difficulty, and a solution mismatch becomes a Finding.
 */

export type Exercise = KnowledgeMap["exercises"][number];
export type Finding = KnowledgeMap["findings"][number];

/** A KC an exercise needs that no KC of the map covers. */
export type ProposedKc = {
  name: string;
  description: string;
  type: Exclude<KcType, "prior">;
  bloom: BloomLevel;
  /** A big idea of the map, by its id. */
  bigIdea: string;
};

/** What the `exercise` call answers for one subtask. */
export type ExerciseAnswer = {
  /** Ids of the map's KCs the subtask needs; unknown ones are dropped. */
  kcIds: string[];
  newKcs: ProposedKc[];
  taskType: string;
  /** The model's own worked solution. */
  solution: string;
  finalResult: string;
  /** Its numeric final results; empty when it asks for no number. */
  finalAnswers: FinalAnswer[];
  /** The number of steps in that solution. */
  steps: number;
  /** Only when a solution was given: its final result and whether it matches. */
  given: { finalResult: string; matches: boolean } | null;
};

/** An exercise subtask as the build analyses it. */
export type ExerciseSubtask = {
  /** Local to the build, such as "e1". */
  id: string;
  name: string;
  questionChunkId: string;
  /** The paired solution chunk, or null without one. */
  solutionChunkId: string | null;
};

const bloomRank = (bloom: BloomLevel | null) =>
  bloom === null ? 0 : BLOOM_LEVELS.indexOf(bloom);

/**
 * An Exercise's difficulty from its KCs and the steps of its solution: 3
 * with at least 4 KCs, a KC at Bloom analyze or above, or at least 5 steps;
 * 1 with at most 2 KCs, all at Bloom apply or below, and at most 2 steps; 2
 * otherwise. Prior KCs have no Bloom level and count as the lowest.
 */
export function difficulty(input: {
  kcCount: number;
  blooms: Array<BloomLevel | null>;
  steps: number;
}): 1 | 2 | 3 {
  const highest = Math.max(0, ...input.blooms.map(bloomRank));
  if (
    input.kcCount >= 4 ||
    highest >= bloomRank("analyze") ||
    input.steps >= 5
  ) {
    return 3;
  }
  if (input.kcCount <= 2 && highest <= bloomRank("apply") && input.steps <= 2) {
    return 1;
  }
  return 2;
}

/**
 * A given solution that matches is `verified`, one that does not is
 * `disputed`, and without one the build's own is `generated`.
 */
export function solutionStatus(
  given: ExerciseAnswer["given"],
): Exclude<SolutionStatus, "given"> {
  if (given === null) return "generated";
  return given.matches ? "verified" : "disputed";
}

/**
 * The name of an exercise subtask as printed, such as "Ex. 7.2b", from its
 * chunk's exercise number; one without a number is named by its place.
 */
export function exerciseName(
  exerciseNumber: string | null,
  place: string,
): string {
  const number = exerciseNumber?.trim();
  return number ? `Ex. ${number}` : `Exercise on ${place}`;
}

/**
 * The Exercise from one subtask's answer, with the KCs of `map` it needs
 * (unknown ids dropped, each once), and a `solution_mismatch` Finding about
 * the question and solution chunks when the given solution is disputed.
 */
export function exerciseFromAnswer(
  subtask: ExerciseSubtask,
  answer: ExerciseAnswer,
  map: Pick<KnowledgeMap, "kcs">,
): { exercise: Exercise; finding: Finding | null } {
  const byId = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const kcs = [...new Set(answer.kcIds)].filter((id) => byId.has(id));
  const status = solutionStatus(answer.given);
  const exercise: Exercise = {
    id: subtask.id,
    name: subtask.name,
    questionChunk: subtask.questionChunkId,
    taskType: answer.taskType.trim(),
    solutionStatus: status,
    solution: status === "generated" ? answer.solution : null,
    difficulty: difficulty({
      kcCount: kcs.length,
      blooms: kcs.map((id) => byId.get(id)?.bloom ?? null),
      steps: answer.steps,
    }),
    kcs,
    finalAnswers: answer.finalAnswers.length > 0 ? answer.finalAnswers : null,
  };
  const finding: Finding | null =
    status === "disputed" && answer.given
      ? {
          kind: "solution_mismatch",
          text: `${subtask.name}: the given answer is ${answer.given.finalResult}, our calculation gives ${answer.finalResult}.`,
          sources: [
            subtask.questionChunkId,
            ...(subtask.solutionChunkId ? [subtask.solutionChunkId] : []),
          ],
        }
      : null;
  return { exercise, finding };
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * The map with the KCs the exercise subtasks propose, and for each subtask
 * the ids of the proposed KCs it needs. A name proposed by more than one
 * subtask (ignoring case) is added once, with `origin = exercise`, the big
 * idea of its first proposal naming one of the map, and the proposing
 * subtasks' question chunks as sources. A proposed name that is already a
 * KC of the map is that KC. Other proposals go.
 */
export function withExerciseKcs(
  map: KnowledgeMap,
  proposals: Array<{ questionChunkId: string; newKcs: ProposedKc[] }>,
): { map: KnowledgeMap; addedKcIds: string[]; kcIds: string[][] } {
  const bigIdeas = new Set(map.bigIdeas.map((bigIdea) => bigIdea.id));
  const existing = new Map(map.kcs.map((kc) => [nameKey(kc.name), kc.id]));
  const byName = new Map<
    string,
    { kc: ProposedKc; chunks: string[]; subtasks: Set<number> }
  >();
  proposals.forEach(({ questionChunkId, newKcs }, subtask) => {
    for (const kc of newKcs) {
      const key = nameKey(kc.name);
      const known = byName.get(key) ?? {
        kc,
        chunks: [],
        subtasks: new Set<number>(),
      };
      if (!bigIdeas.has(known.kc.bigIdea) && bigIdeas.has(kc.bigIdea)) {
        known.kc = { ...known.kc, bigIdea: kc.bigIdea };
      }
      if (!known.chunks.includes(questionChunkId)) {
        known.chunks.push(questionChunkId);
      }
      known.subtasks.add(subtask);
      byName.set(key, known);
    }
  });

  const kcs = [...map.kcs];
  const addedKcIds: string[] = [];
  const kcIds = proposals.map((): string[] => []);
  for (const [key, { kc, chunks, subtasks }] of byName) {
    let id = existing.get(key);
    if (!id) {
      if (subtasks.size < 2 || !bigIdeas.has(kc.bigIdea)) continue;
      id = `x${addedKcIds.length + 1}`;
      kcs.push({
        id,
        name: kc.name.trim(),
        description: kc.description,
        type: kc.type,
        bloom: kc.bloom,
        bigIdea: kc.bigIdea,
        origin: "exercise",
        sources: chunks,
      });
      addedKcIds.push(id);
    }
    for (const subtask of subtasks) kcIds[subtask]?.push(id);
  }
  return { map: { ...map, kcs }, addedKcIds, kcIds };
}

/**
 * The check report's Exercise entries: Exercises mapped to no KC, which fail
 * the check, and KCs no Exercise tests, reported only. Prior KCs are left
 * out: the Course assumes them rather than teaches them.
 */
export function checkExercises(map: KnowledgeMap): {
  unmappedExercises: string[];
  untestedKcs: string[];
} {
  const tested = new Set(map.exercises.flatMap((exercise) => exercise.kcs));
  return {
    unmappedExercises: map.exercises
      .filter((exercise) => exercise.kcs.length === 0)
      .map((exercise) => exercise.name),
    untestedKcs: map.kcs
      .filter((kc) => kc.origin !== "prior" && !tested.has(kc.id))
      .map((kc) => kc.name),
  };
}
