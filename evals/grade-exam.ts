import { readFile } from "node:fs/promises";
import { generateText } from "ai";
import { z } from "zod";
import {
  awardedPoints,
  checkMockValue,
  gradeExamCall,
} from "@/features/study/server";
import type { EvalDefinition } from "./eval";

/**
 * The `grade_exam` task (#186): one call per answered subtask of a mock
 * exam, followed by the numeric check of its final value and the points
 * cap, as the `gradeMock` workflow runs them, without a database. About 25
 * subtasks in 3 mocks, drafted on the jet-engines gold course: full
 * answers, partial ones, slips and a final value off the key. The expected
 * points are drafts until the maintainer confirms them.
 *
 * Gates over the whole dataset, reported and never blocking: the mean
 * absolute error is at most 10% of a subtask's points, and no subtask whose
 * final value is wrong gets full marks.
 */

const input = z.object({
  /** The mock the subtask belongs to, for the reader. */
  mock: z.string(),
  prompt: z.string(),
  points: z.number().positive(),
  reference: z.string().nullable(),
  answer: z.string(),
  /** The numeric key the final value is checked against; null without one. */
  finalAnswers: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        unit: z.string().nullable(),
      }),
    )
    .nullable(),
  kcIds: z.array(z.string()).min(1),
});

const expectedOutput = z.object({
  /** "draft" until the maintainer confirms the points. */
  labelStatus: z.enum(["draft", "confirmed"]),
  awarded: z.number().min(0),
  /** The answer's final value is off the key. */
  wrongFinal: z.boolean(),
});

type Input = z.infer<typeof input>;
type Expected = z.infer<typeof expectedOutput>;

/** What the task returns: the points the workflow would store, as JSON. */
const gradedSchema = z.object({
  awarded: z.number(),
  points: z.number(),
  check: z.enum(["match", "mismatch"]).nullable(),
});

const goldSchema = z.object({
  kcs: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string() }),
  ),
});

let goldCache: Promise<z.infer<typeof goldSchema>> | undefined;
function loadGold() {
  goldCache ??= readFile("evals/gold/jet-engines/gold.json", "utf8").then(
    (text) => goldSchema.parse(JSON.parse(text)),
  );
  return goldCache;
}

async function gradeExamTask(item: Input): Promise<string> {
  const gold = await loadGold();
  const kcs = item.kcIds.map((id) => {
    const kc = gold.kcs.find((candidate) => candidate.id === id);
    if (!kc) throw new Error(`${id} is no KC of the gold course.`);
    return kc;
  });
  const { call, grading } = gradeExamCall({
    prompt: item.prompt,
    points: item.points,
    reference: item.reference,
    answer: item.answer,
    kcs,
  });
  const result = await generateText(call);
  const graded = grading(result.output);
  const check = checkMockValue(item.finalAnswers, graded.finalValue);
  return JSON.stringify({
    awarded: awardedPoints(graded.steps, item.points, check),
    points: item.points,
    check,
  } satisfies z.infer<typeof gradedSchema>);
}

/** What one subtask adds to the counts of the gates. */
export function scoreGradeExam(output: string, expected: Expected) {
  const { awarded, points } = gradedSchema.parse(JSON.parse(output));
  return {
    errorShare: Math.abs(awarded - expected.awarded) / points,
    wrongFinal: expected.wrongFinal ? 1 : 0,
    falseFull: expected.wrongFinal && awarded >= points ? 1 : 0,
  };
}

/** Gate thresholds over the whole dataset. */
const MAX_MEAN_ERROR_SHARE = 0.1;

type ScoreList = Array<{ name: string; value: unknown }>;

function sum(items: Array<{ evaluations: ScoreList }>, name: string) {
  return items.reduce((total, { evaluations }) => {
    const score = evaluations.find((e) => e.name === name)?.value;
    return total + (typeof score === "number" ? score : 0);
  }, 0);
}

/**
 * The gates' verdicts. The labels are drafts, so the eval reports them and
 * never fails the run.
 */
export function gradeExamGates(items: Array<{ evaluations: ScoreList }>) {
  const n = items.length;
  const meanError = n === 0 ? 1 : sum(items, "error_share") / n;
  const falseFull = sum(items, "false_full");
  const wrongFinal = sum(items, "wrong_final");
  const verdict = (met: boolean) => (met ? "met" : "not met");
  return {
    passed: true,
    summary: `mean absolute error ${(meanError * 100).toFixed(1)}% of the points (at most ${MAX_MEAN_ERROR_SHARE * 100}%: ${verdict(n > 0 && meanError <= MAX_MEAN_ERROR_SHARE)}), full marks for a wrong final value ${falseFull} of ${wrongFinal} (must be 0: ${verdict(falseFull === 0)}), over ${n} subtasks; reported, not blocking`,
  };
}

export const gradeExamEval: EvalDefinition<Input, Expected> = {
  name: "grade_exam",
  input,
  expectedOutput,
  task: gradeExamTask,
  evaluators: [
    async ({ output, expectedOutput: expected }) => {
      const score = scoreGradeExam(output, expected!);
      const { awarded, points, check } = gradedSchema.parse(JSON.parse(output));
      const comment = `awarded ${awarded} of ${points} (check ${check ?? "none"}); expected ${expected!.awarded}`;
      return [
        { name: "error_share", value: score.errorShare, comment },
        { name: "wrong_final", value: score.wrongFinal },
        { name: "false_full", value: score.falseFull },
      ];
    },
  ],
  gates: [],
  minPassRate: 0,
  aggregate: gradeExamGates,
};
