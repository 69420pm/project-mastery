import { readFile } from "node:fs/promises";
import { generateText } from "ai";
import { z } from "zod";
import {
  checkDraft,
  generateCall,
  mathRunner,
  retryMessages,
  type GenerateInput,
} from "@/features/study/server";
import { costUsd, tokenUsage } from "@/lib/ai/cost";
import { aiTask } from "@/lib/ai/models";
import type { EvalDefinition } from "./eval";

/**
 * The `generate` task (#183, ADR 0021): one call per Problem, run as the
 * workflow runs it (the same call, the same check of the draft, one retry
 * with the error), without a database. 10 variants of the jet-engines gold
 * course's Exercises and 10 new Problems on its KCs; the same task runs on
 * a real course, exported into the gitignored `evals/datasets/private/`
 * (`pnpm evals:export-generate <courseId>`), because the repo is public.
 *
 * Measured: schema validity, success on the first try and after the retry,
 * and cost per stored Problem. Code checks nothing about quality: the
 * evaluator prints each Problem for the maintainer to read.
 *
 * Gate over the whole dataset: every numeric Problem's program runs, that
 * is, no Problem fails with a program error after the retry.
 */

const GOLD = "evals/gold/jet-engines/gold.json";
const CHUNKS = "evals/gold/jet-engines/chunks.json";

const kcSchema = z.object({ name: z.string(), description: z.string() });

/** A call input given in full, as the export writes it. */
const givenInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("variant"),
    exercise: z.object({
      question: z.string(),
      solution: z.string().nullable(),
      finalAnswers: z
        .array(
          z.object({
            label: z.string(),
            value: z.number(),
            unit: z.string().nullable(),
          }),
        )
        .nullable(),
      taskType: z.string(),
      difficulty: z.number(),
    }),
    kcs: z.array(kcSchema),
  }),
  z.object({
    kind: z.literal("new"),
    kcs: z.array(kcSchema.extend({ sources: z.array(z.string()) })),
    difficulty: z.number(),
    styleAnchors: z.array(
      z.object({ question: z.string(), taskType: z.string() }),
    ),
  }),
]);

const input = z.union([
  /** A variant of a gold Exercise, by name. */
  z.object({ kind: z.literal("gold_variant"), exercise: z.string() }),
  /** A new Problem for gold KCs, by id. */
  z.object({
    kind: z.literal("gold_new"),
    kcs: z.array(z.string()).min(1),
    difficulty: z.number().int().min(1).max(3),
  }),
  z.object({ kind: z.literal("given"), input: givenInput }),
]);

const expectedOutput = z.null();

type Input = z.infer<typeof input>;

// --- The gold course ------------------------------------------------------

const goldSchema = z.object({
  kcs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      bigIdea: z.string().nullable(),
      sources: z.array(z.number()),
    }),
  ),
  exercises: z.array(
    z.object({
      name: z.string(),
      questionChunk: z.number(),
      taskType: z.string(),
      difficulty: z.number(),
      kcs: z.array(z.string()),
    }),
  ),
});

const chunksSchema = z.array(
  z.object({
    position: z.number(),
    markdown: z.string(),
    solution_position: z.number().nullable().optional(),
  }),
);

/** Sources a new Problem gets per KC, and style anchors, as in the workflow. */
const SOURCES_PER_KC = 3;
const STYLE_ANCHORS = 2;

/** The call input an item stands for; gold references resolve here. */
export async function callInput(item: Input): Promise<GenerateInput> {
  if (item.kind === "given") return item.input;
  const [gold, chunks] = await Promise.all([
    readFile(GOLD, "utf8").then((text) => goldSchema.parse(JSON.parse(text))),
    readFile(CHUNKS, "utf8").then((text) =>
      chunksSchema.parse(JSON.parse(text)),
    ),
  ]);
  const markdown = (position: number | null | undefined) =>
    chunks.find((chunk) => chunk.position === position)?.markdown ?? null;
  const kcsOf = (ids: string[]) =>
    ids.map((id) => {
      const kc = gold.kcs.find((candidate) => candidate.id === id);
      if (!kc) throw new Error(`No gold KC ${id}`);
      return kc;
    });

  if (item.kind === "gold_variant") {
    const exercise = gold.exercises.find(({ name }) => name === item.exercise);
    const question = markdown(exercise?.questionChunk);
    if (!exercise || question === null) {
      throw new Error(`No gold Exercise ${item.exercise}`);
    }
    const solutionAt = chunks.find(
      (chunk) => chunk.position === exercise.questionChunk,
    )?.solution_position;
    return {
      kind: "variant",
      exercise: {
        question,
        solution: markdown(solutionAt),
        finalAnswers: null,
        taskType: exercise.taskType,
        difficulty: exercise.difficulty,
      },
      kcs: kcsOf(exercise.kcs).map(({ name, description }) => ({
        name,
        description,
      })),
    };
  }

  const kcs = kcsOf(item.kcs);
  const bigIdeas = new Set(kcs.map((kc) => kc.bigIdea));
  const near = gold.exercises.filter((exercise) =>
    kcsOf(exercise.kcs).some((kc) => bigIdeas.has(kc.bigIdea)),
  );
  return {
    kind: "new",
    kcs: kcs.map(({ name, description, sources }) => ({
      name,
      description,
      sources: sources
        .slice(0, SOURCES_PER_KC)
        .flatMap((position) => markdown(position) ?? []),
    })),
    difficulty: item.difficulty,
    styleAnchors: (near.length > 0 ? near : gold.exercises)
      .slice(0, STYLE_ANCHORS)
      .flatMap((exercise) => {
        const question = markdown(exercise.questionChunk);
        return question === null
          ? []
          : [{ question, taskType: exercise.taskType }];
      }),
  };
}

// --- One Problem ----------------------------------------------------------

/** What one item did, as the evaluator reads it. */
export type GenerateRecord = {
  kind: GenerateInput["kind"];
  /** The first draft was a valid JSON object of the requested shape. */
  schemaValid: boolean;
  /** The first draft passed the check: its program ran, placeholders filled. */
  firstTry: boolean;
  /** The Problem would be stored: the first or the retry's draft passed. */
  stored: boolean;
  /** The last failure, null when stored. */
  error: string | null;
  /** Every failed draft's error, in order: one, two, or none. */
  errors: string[];
  calls: number;
  costUsd: number;
  program: string | null;
  statement: string | null;
  solution: string | null;
  finalAnswers: unknown;
};

type Attempt =
  | { ok: true; checked: Awaited<ReturnType<typeof checkDraft>> & { ok: true } }
  | { ok: false; schemaValid: boolean; output: unknown; error: string };

async function generateTask(item: Input): Promise<string> {
  const generateInput = await callInput(item);
  const { call, draft } = generateCall(generateInput);
  const { model } = aiTask("generate");
  let cost = 0;
  let calls = 0;
  let program: string | null = null;

  const attempt = async (messages: typeof call.messages): Promise<Attempt> => {
    // A failed model call is not the draft's failure: it throws, as in the
    // workflow, where it fails the Problem without a retry.
    const result = await generateText({ ...call, messages });
    calls += 1;
    cost += costUsd(model, tokenUsage(result.usage));
    let output: unknown = null;
    try {
      output = result.output;
      const parsed = draft(output);
      program = parsed.program;
      const checked = await checkDraft(parsed, mathRunner);
      return checked.ok
        ? { ok: true, checked }
        : { ok: false, schemaValid: true, output, error: checked.error };
    } catch {
      return {
        ok: false,
        schemaValid: false,
        output,
        error: "The answer was no valid JSON object of the requested shape.",
      };
    }
  };

  const first = await attempt(call.messages);
  const last = first.ok
    ? first
    : await attempt(retryMessages(call.messages, first.output, first.error));
  const problem = last.ok ? last.checked.problem : null;
  const record: GenerateRecord = {
    kind: generateInput.kind,
    schemaValid: first.ok || first.schemaValid,
    firstTry: first.ok,
    stored: last.ok,
    error: last.ok ? null : last.error,
    errors: [first, ...(first.ok ? [] : [last])].flatMap((a) =>
      a.ok ? [] : [a.error],
    ),
    calls,
    costUsd: cost,
    program: problem ? problem.program : program,
    statement: problem?.statement ?? null,
    solution: problem?.solution ?? null,
    finalAnswers: problem?.finalAnswers ?? null,
  };
  return JSON.stringify(record);
}

// --- The scores -----------------------------------------------------------

const GATES = ["program_runs"];

/** The scores of one item. `program_runs` is the gate. */
export function scoreGenerate(record: GenerateRecord) {
  // A Problem not stored whose program failed on either draft: a retry that
  // then fails the schema never ran its program.
  const programFailed =
    !record.stored && record.errors.some((e) => e.startsWith("Program:"));
  return [
    { name: "schema_valid", value: record.schemaValid ? 1 : 0 },
    { name: "first_try", value: record.firstTry ? 1 : 0 },
    {
      name: "after_retry",
      value: record.stored ? 1 : 0,
      ...(record.error && { comment: record.error }),
    },
    { name: "program_runs", value: programFailed ? 0 : 1 },
    { name: "model_calls", value: record.calls },
    { name: "cost_usd", value: record.costUsd },
  ];
}

type ScoreList = Array<{ name: string; value: unknown }>;

/** The gate and the rates: every numeric Problem's program runs. */
export function generateGate(items: Array<{ evaluations: ScoreList }>) {
  const sum = (name: string) =>
    items.reduce(
      (total, { evaluations }) =>
        total + Number(evaluations.find((e) => e.name === name)?.value ?? 0),
      0,
    );
  const n = items.length;
  const stored = sum("after_retry");
  const programFailures = n - sum("program_runs");
  return {
    passed: n > 0 && programFailures === 0,
    summary: `${n} Problems: schema valid ${sum("schema_valid")}, first try ${sum("first_try")}, stored after the retry ${stored}, program failures ${programFailures} (must be 0), $${sum("cost_usd").toFixed(4)} in ${sum("model_calls")} calls, $${(stored === 0 ? 0 : sum("cost_usd") / stored).toFixed(5)} per stored Problem`,
  };
}

function define(
  name: string,
  privateFixture?: string,
): EvalDefinition<Input, null> {
  return {
    name,
    input,
    expectedOutput,
    task: generateTask,
    evaluators: [
      async ({ output }) => {
        const record = JSON.parse(output) as GenerateRecord;
        // For the maintainer's spot check: quality stays human-read.
        console.info(
          `\n--- ${record.kind} (${record.stored ? "stored" : `failed: ${record.error}`})\n${record.statement ?? ""}\n--- Solution\n${record.solution ?? ""}\n--- Program\n${record.program ?? "none"}\n--- Final answers ${JSON.stringify(record.finalAnswers)}`,
        );
        return scoreGenerate(record);
      },
    ],
    gates: GATES,
    minPassRate: 1,
    aggregate: generateGate,
    ...(privateFixture && { privateFixture }),
  };
}

export const generateEval = define("generate");

/** The same task on a real course, exported by `pnpm evals:export-generate`. */
export const generateRealEval = define(
  "generate-real",
  "evals/datasets/private/generate-real.json",
);
