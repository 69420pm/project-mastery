import type { ExtractedKc } from "@/features/knowledge-map/domain/part-extraction";
import type {
  ExtractedExercise,
  FinalAnswer,
  KcType,
} from "@/features/knowledge-map/schemas";

/**
 * The extraction of one exercise Part (task `exercise`): per subtask, the
 * candidate KCs it tests, new KCs only when none fits, and its final
 * answers as printed. Checked in code against the ids the call was offered;
 * the difficulty follows in code once the KCs are stored.
 */

/** The most KCs one Exercise tests. */
export const MAX_EXERCISE_KCS = 6;

/** The most final answers one Exercise keeps. */
const MAX_FINAL_ANSWERS = 10;

/** What the call answers for one subtask, with the call's ids. */
export type AnsweredSubtask = {
  id: string;
  notAnExercise: boolean;
  kcIds: string[];
  newKcs: Array<{ name: string; description: string; type: KcType }>;
  finalAnswers: Array<{ label: string; value: number; unit: string | null }>;
};

/** A subtask the call was offered, with its stored chunks. */
export type OfferedSubtask = {
  /** The call's id, such as s1. */
  id: string;
  chunkId: string;
  solutionChunkId: string | null;
  /** The printed solution's Markdown; null without one. */
  solution: string | null;
};

/** The non-blank lines of a printed solution; null without one. */
export function solutionLines(solution: string | null): number | null {
  if (solution === null) return null;
  return solution.split("\n").filter((line) => line.trim()).length;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Checks the call's answer for an exercise Part: an unknown candidate id is
 * dropped, a new KC whose name the Part already proposed is the same KC, and
 * an Exercise tests at most MAX_EXERCISE_KCS KCs, candidates first. A
 * subtask the call left out is an Exercise without KCs or final answers.
 */
export function checkExerciseAnswer(
  answer: { subtasks: AnsweredSubtask[] },
  subtasks: readonly OfferedSubtask[],
  kcIdOf: ReadonlyMap<string, string>,
): { kcs: ExtractedKc[]; exercises: ExtractedExercise[] } {
  const kcs: ExtractedKc[] = [];
  const indexOf = new Map<string, number>();
  const exercises = subtasks.map((subtask): ExtractedExercise => {
    const answered = answer.subtasks.find((given) => given.id === subtask.id);
    const kcIds = [
      ...new Set(answered?.kcIds.flatMap((id) => kcIdOf.get(id) ?? []) ?? []),
    ].slice(0, MAX_EXERCISE_KCS);
    const newKcs: number[] = [];
    for (const kc of answered?.newKcs ?? []) {
      if (kcIds.length + newKcs.length >= MAX_EXERCISE_KCS) break;
      const name = kc.name.trim().slice(0, 200);
      const description = kc.description.trim().slice(0, 1000);
      if (!name || !description) continue;
      let index = indexOf.get(nameKey(name));
      if (index === undefined) {
        index = kcs.length;
        indexOf.set(nameKey(name), index);
        kcs.push({
          name,
          description,
          type: kc.type,
          chunkIds: [subtask.chunkId],
          assumes: [],
        });
      } else if (!kcs[index]!.chunkIds.includes(subtask.chunkId)) {
        kcs[index]!.chunkIds.push(subtask.chunkId);
      }
      if (!newKcs.includes(index)) newKcs.push(index);
    }
    return {
      chunkId: subtask.chunkId,
      solutionChunkId: subtask.solutionChunkId,
      notAnExercise: answered?.notAnExercise ?? false,
      kcIds,
      newKcs,
      finalAnswers: checkFinalAnswers(answered?.finalAnswers ?? []),
      solutionLines: solutionLines(subtask.solution),
    };
  });
  return { kcs, exercises };
}

function checkFinalAnswers(
  answers: AnsweredSubtask["finalAnswers"],
): FinalAnswer[] {
  return answers
    .flatMap((answer) => {
      const label = answer.label.trim().slice(0, 200);
      const unit = answer.unit?.trim().slice(0, 50) || null;
      return label && Number.isFinite(answer.value)
        ? [{ label, value: answer.value, unit }]
        : [];
    })
    .slice(0, MAX_FINAL_ANSWERS);
}

/**
 * An Exercise's difficulty, in code: 3 with 3 or more KCs or a printed
 * solution of 12 or more lines; 1 with at most one KC and a printed
 * solution of 4 lines or fewer, or none; 2 otherwise.
 */
export function exerciseDifficulty(
  kcCount: number,
  lines: number | null,
): 1 | 2 | 3 {
  if (kcCount >= 3 || (lines ?? 0) >= 12) return 3;
  if (kcCount <= 1 && (lines ?? 0) <= 4) return 1;
  return 2;
}

/**
 * Whether an exercise Part needs its extraction call: it has none for its
 * content, or an exercise chunk's paired solution is no longer the one it
 * was extracted with.
 */
export function needsExerciseExtraction(
  stored: { contentHash: string; exercises?: ExtractedExercise[] } | undefined,
  part: { contentHash: string; exerciseChunkIds: readonly string[] },
  solutionOf: (chunkId: string) => string | null,
): boolean {
  if (!stored?.exercises || stored.contentHash !== part.contentHash) {
    return true;
  }
  const extracted = new Map(
    stored.exercises.map((exercise) => [
      exercise.chunkId,
      exercise.solutionChunkId,
    ]),
  );
  return part.exerciseChunkIds.some(
    (chunkId) =>
      !extracted.has(chunkId) || extracted.get(chunkId) !== solutionOf(chunkId),
  );
}
