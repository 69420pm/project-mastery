import "server-only";
import {
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import type { loadStoredMap } from "@/features/knowledge-map/server";
import {
  generatedSolutionLabel,
  rankProblems,
  solutionLabel,
  targetDifficulty,
  type ProblemSource,
} from "@/features/study/domain/exercises";
import {
  loadAskedProblems,
  loadLastProblem,
  loadLastUnassistedSuccess,
} from "@/features/study/server/attempts";
import {
  loadReadyProblems,
  type ReadyProblem,
} from "@/features/study/server/problems";
import { chunkLink } from "@/features/study/server/source-view";
import type { ProblemView } from "@/features/study/types";
import type { Supabase } from "@/lib/supabase/types";

type KnowledgeMap = Awaited<ReturnType<typeof loadStoredMap>>;
type Exercise = KnowledgeMap["exercises"][number];
type Chunk = Awaited<ReturnType<typeof loadChunkSources>>[number];

/** A candidate as ranking reads it, with what its view needs. */
type Candidate =
  | {
      kind: "exercise";
      id: string;
      kcs: string[];
      taskType: string;
      difficulty: number;
      source: ProblemSource;
      exercise: Exercise;
      chunk: Chunk;
    }
  | {
      kind: "generated";
      id: string;
      kcs: string[];
      taskType: string | null;
      difficulty: number;
      source: ProblemSource;
      problem: ReadyProblem;
    };

/**
 * `findProblems` for KCs of the Course (#102, #182, #183): up to 3 of the
 * unseen Exercises and the ready, unflagged generated Problems not yet asked
 * in the Course that test any of them, ranked by `rankProblems` against the
 * last Problem's task type and one above the last unassisted success. A
 * note, without Problems, tells the model why there are none.
 */
export async function findProblems(
  supabase: Supabase,
  courseId: string,
  map: KnowledgeMap,
  kcIds: string[],
): Promise<{ problems: ProblemView[]; note?: string }> {
  const [asked, lastProblem, lastSuccess, generated] = await Promise.all([
    loadAskedProblems(supabase, courseId),
    loadLastProblem(supabase, courseId),
    loadLastUnassistedSuccess(supabase, courseId, kcIds),
    loadReadyProblems(supabase, courseId),
  ]);
  const exerciseById = new Map(map.exercises.map((e) => [e.id, e]));
  const generatedById = new Map(generated.map((p) => [p.id, p]));
  const posed = (id: string | null) =>
    id === null ? undefined : (exerciseById.get(id) ?? generatedById.get(id));
  const lastTaskType = posed(lastProblem)?.taskType ?? null;
  const target = targetDifficulty(posed(lastSuccess)?.difficulty ?? null);

  const tests = ({ kcs }: { kcs: string[] }) =>
    kcs.some((id) => kcIds.includes(id));
  const exercises = map.exercises.filter(tests);
  const problems = generated.filter(tests);
  const unseen = exercises.filter(({ id }) => !asked.has(id));
  const unasked = problems.filter(({ id }) => !asked.has(id));
  if (unseen.length === 0 && unasked.length === 0) {
    return {
      problems: [],
      note:
        exercises.length === 0 && problems.length === 0
          ? "This Course has no Exercises for these KCs: pose a problem of your own."
          : "The Student has tried every Exercise of this Course for these KCs: pose a problem of your own.",
    };
  }

  const [paired, questionChunks] = await Promise.all([
    loadExerciseSolutions(supabase, courseId),
    loadChunkSources(
      supabase,
      unseen.map((exercise) => exercise.questionChunk),
    ),
  ]);
  const question = new Map(questionChunks.map((c) => [c.id, c]));
  const found = rankProblems<Candidate>(
    [
      ...unseen.flatMap((exercise) => {
        const chunk = question.get(exercise.questionChunk);
        return chunk
          ? [
              {
                kind: "exercise" as const,
                id: exercise.id,
                kcs: exercise.kcs,
                taskType: exercise.taskType,
                difficulty: exercise.difficulty,
                source: chunk.isExam ? "old_exam" : "exercise",
                exercise,
                chunk,
              } satisfies Candidate,
            ]
          : [];
      }),
      ...unasked.map(
        (problem) =>
          ({
            kind: "generated",
            id: problem.id,
            kcs: problem.kcs,
            taskType: problem.taskType,
            difficulty: problem.difficulty,
            source: problem.source,
            problem,
          }) satisfies Candidate,
      ),
    ],
    kcIds,
    lastTaskType,
    target,
  );
  const solutionIds = found.flatMap((candidate) =>
    candidate.kind === "exercise"
      ? (paired[candidate.exercise.questionChunk] ?? [])
      : [],
  );
  const solutions = new Map(
    (await loadChunkSources(supabase, solutionIds)).map((c) => [c.id, c]),
  );
  const kcName = new Map(map.kcs.map((kc) => [kc.id, kc.name]));
  const kcs = (ids: string[]) =>
    ids.flatMap((id) => {
      const name = kcName.get(id);
      return name === undefined ? [] : [{ id, name }];
    });
  return {
    problems: found.map((candidate): ProblemView => {
      const common = {
        id: candidate.id,
        source: candidate.source,
        taskType: candidate.taskType,
        difficulty: candidate.difficulty,
        kcs: kcs(candidate.kcs),
      };
      if (candidate.kind === "generated") {
        const { problem } = candidate;
        const original = problem.originalExerciseId
          ? exerciseById.get(problem.originalExerciseId)
          : undefined;
        return {
          ...common,
          name:
            problem.source === "new"
              ? "New problem"
              : original
                ? `Variant of ${original.name}`
                : "Variant",
          question: problem.statement,
          link: null,
          solution: {
            status: generatedSolutionLabel(problem.hasProgram),
            markdown: problem.solution,
          },
        };
      }
      const { exercise, chunk } = candidate;
      const solutionChunk = solutions.get(paired[exercise.questionChunk] ?? "");
      return {
        ...common,
        name: exercise.name,
        question: chunk.markdown,
        link: chunkLink(courseId, chunk),
        solution: {
          status: solutionLabel(exercise.solutionStatus),
          markdown: exercise.solution ?? solutionChunk?.markdown ?? null,
        },
      };
    }),
  };
}
