import "server-only";
import {
  loadChunkSources,
  loadExerciseSolutions,
} from "@/features/ingestion/server";
import {
  loadStoredMap,
  loadStoredTopics,
} from "@/features/knowledge-map/server";
import {
  generateCall,
  retryMessages,
  type GenerateInput,
} from "@/features/study/ai/generate-call";
import { mathRunner } from "@/features/study/server/math-runner";
import {
  checkDraft,
  type CheckedProblem,
} from "@/features/study/server/problem-draft";
import { meteredGenerate } from "@/features/usage/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failed } from "@/lib/supabase/failed";
import type { Supabase } from "@/lib/supabase/types";

/**
 * The step that writes one queued Problem of a generate run
 * (`generate-problems.ts`): one call of task `generate`, its program run and
 * its placeholders filled in, with the draft sent back once with the error
 * when that fails.
 */

/** Source chunks a new Problem gets per KC. */
const SOURCES_PER_KC = 3;

/** Exercises a new Problem gets as style anchors. */
const STYLE_ANCHORS = 2;

/** What became of a queued Problem. */
export type GenerateOutcome = "ready" | "failed" | "limited" | "gone";

type QueuedProblem = {
  id: string;
  owner: string;
  courseId: string;
  topicId: string | null;
  originalExerciseId: string | null;
  difficulty: number;
  kcs: string[];
  source: string;
};

/** One call's draft, checked: the Problem, or what failed it. */
type Attempt =
  | { kind: "limited" }
  | { kind: "callFailed" }
  | {
      kind: "checked";
      output: unknown;
      problem: CheckedProblem;
      taskType: string | null;
    }
  | {
      kind: "rejected";
      output: unknown;
      error: string;
      /** The draft's program, kept with a failure to see what failed. */
      program: string | null;
    };

/**
 * Writes the queued Problem: `ready` with its texts and the program's final
 * answers, `failed` with the reason when the draft fails twice or the model
 * call fails, or leaves it queued (`limited`) when the Student's Daily
 * limit or the provider's daily quota is used up. `gone` when it is no
 * longer queued.
 */
export async function generateProblem(
  problemId: string,
): Promise<GenerateOutcome> {
  "use step";
  const supabase = createAdminClient();
  const problem = await loadQueuedProblem(supabase, problemId);
  if (!problem) return "gone";
  const input = await generateInput(supabase, problem);
  if (typeof input === "string") {
    return fail(supabase, problemId, input);
  }

  const { call, draft } = generateCall(input);
  const attempt = async (messages: typeof call.messages): Promise<Attempt> => {
    let result: { readonly output: unknown } | null;
    try {
      result = await meteredGenerate(
        supabase,
        {
          studentId: problem.owner,
          task: "generate",
          traceName: "generate-problem",
        },
        { ...call, messages },
      );
    } catch (error) {
      console.error("A generate call failed:", error);
      return { kind: "callFailed" };
    }
    if (!result) return { kind: "limited" };
    let output: unknown = null;
    try {
      output = result.output;
      const parsed = draft(output);
      const checked = await checkDraft(parsed, mathRunner);
      return checked.ok
        ? {
            kind: "checked",
            output,
            problem: checked.problem,
            taskType: parsed.taskType,
          }
        : {
            kind: "rejected",
            output,
            error: checked.error,
            program: parsed.program,
          };
    } catch {
      return {
        kind: "rejected",
        output,
        error: "The answer was no valid JSON object of the requested shape.",
        program: null,
      };
    }
  };

  let outcome = await attempt(call.messages);
  if (outcome.kind === "rejected") {
    outcome = await attempt(
      retryMessages(call.messages, outcome.output, outcome.error),
    );
  }
  switch (outcome.kind) {
    case "limited":
      return "limited";
    case "callFailed":
      return fail(supabase, problemId, "The model call failed.");
    case "rejected":
      return fail(supabase, problemId, outcome.error, outcome.program);
    case "checked":
      return store(supabase, problemId, outcome.problem, outcome.taskType);
  }
}

async function loadQueuedProblem(
  supabase: Supabase,
  problemId: string,
): Promise<QueuedProblem | null> {
  const { data, error } = await supabase
    .from("problems")
    .select(
      "id, owner, course_id, source, topic_id, original_exercise_id, difficulty, problem_kcs(kc_id)",
    )
    .eq("id", problemId)
    .eq("status", "queued")
    .maybeSingle();
  if (error) failed("Loading the queued Problem", error);
  if (!data) return null;
  return {
    id: data.id,
    owner: data.owner,
    courseId: data.course_id,
    source: data.source,
    topicId: data.topic_id,
    originalExerciseId: data.original_exercise_id,
    difficulty: data.difficulty,
    kcs: data.problem_kcs.map(({ kc_id }) => kc_id),
  };
}

/**
 * The call's input for the Problem: its Exercise for a variant; for a new
 * Problem its KCs with their sources and up to 2 Exercises of its Topic, or
 * of its KCs without one, as style anchors. The reason it fails when the
 * Exercise is gone.
 */
async function generateInput(
  supabase: Supabase,
  problem: QueuedProblem,
): Promise<GenerateInput | string> {
  const map = await loadStoredMap(supabase, problem.courseId);
  const kcById = new Map(map.kcs.map((kc) => [kc.id, kc]));
  const kcs = problem.kcs.flatMap((id) => {
    const kc = kcById.get(id);
    return kc ? [kc] : [];
  });
  const describe = ({
    name,
    description,
  }: {
    name: string;
    description: string;
  }) => ({
    name,
    description,
  });

  if (problem.source === "variant") {
    const exercise = map.exercises.find(
      ({ id }) => id === problem.originalExerciseId,
    );
    if (!exercise) return "The Exercise to vary is gone.";
    const paired = await loadExerciseSolutions(supabase, problem.courseId);
    const solutionChunk = paired[exercise.questionChunk];
    const chunks = await loadChunkSources(supabase, [
      exercise.questionChunk,
      ...(solutionChunk ? [solutionChunk] : []),
    ]);
    const markdown = (id: string | null | undefined) =>
      chunks.find((chunk) => chunk.id === id)?.markdown ?? null;
    const question = markdown(exercise.questionChunk);
    if (question === null) return "The Exercise's question is gone.";
    return {
      kind: "variant",
      exercise: {
        question,
        solution: exercise.solution ?? markdown(solutionChunk),
        finalAnswers: exercise.finalAnswers ?? null,
        taskType: exercise.taskType,
        difficulty: exercise.difficulty,
      },
      kcs: kcs.map(describe),
    };
  }

  const topics = await loadStoredTopics(supabase, problem.courseId);
  const topicKcs =
    topics.find(({ id }) => id === problem.topicId)?.kcs ??
    topics.find((topic) => problem.kcs.some((id) => topic.kcs.includes(id)))
      ?.kcs ??
    problem.kcs;
  const anchors = map.exercises
    .filter((exercise) => exercise.kcs.some((id) => topicKcs.includes(id)))
    .slice(0, STYLE_ANCHORS);
  const sourceIds = kcs.map((kc) => kc.sources.slice(0, SOURCES_PER_KC));
  const chunks = await loadChunkSources(supabase, [
    ...sourceIds.flat(),
    ...anchors.map((exercise) => exercise.questionChunk),
  ]);
  const markdown = new Map(chunks.map((chunk) => [chunk.id, chunk.markdown]));
  const texts = (ids: string[]) => ids.flatMap((id) => markdown.get(id) ?? []);
  return {
    kind: "new",
    kcs: kcs.map((kc, i) => ({
      ...describe(kc),
      sources: texts(sourceIds[i] ?? []),
    })),
    difficulty: problem.difficulty,
    styleAnchors: anchors.flatMap((exercise) =>
      texts([exercise.questionChunk]).map((question) => ({
        question,
        taskType: exercise.taskType,
      })),
    ),
  };
}

/** Stores a checked Problem as ready, while it is still queued. */
async function store(
  supabase: Supabase,
  problemId: string,
  problem: CheckedProblem,
  taskType: string | null,
): Promise<GenerateOutcome> {
  const { error } = await supabase
    .from("problems")
    .update({
      status: "ready",
      statement: problem.statement,
      solution: problem.solution,
      program: problem.program,
      final_answers: problem.finalAnswers,
      ...(taskType !== null && { task_type: taskType }),
    })
    .eq("id", problemId)
    .eq("status", "queued");
  if (error) failed("Storing the generated Problem", error);
  return "ready";
}

/** Marks the queued Problem failed with the reason and its last program. */
async function fail(
  supabase: Supabase,
  problemId: string,
  reason: string,
  program: string | null = null,
): Promise<GenerateOutcome> {
  const { error } = await supabase
    .from("problems")
    .update({ status: "failed", failure: reason.slice(0, 2_000), program })
    .eq("id", problemId)
    .eq("status", "queued");
  if (error) failed("Recording the failed Problem", error);
  return "failed";
}
