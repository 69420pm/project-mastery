import { Output, type ModelMessage } from "ai";
import { z } from "zod";
import type { GradedStep } from "@/features/study/domain/mock-grading";
import type { AttemptResult } from "@/features/study/domain/replay";
import { aiTask } from "@/lib/ai/models";

/**
 * The one model call that grades an answered item of a Mock exam (task
 * `grade_exam`, #186): points per step with a reason, a result per KC and
 * the Student's final value, which code checks against the item's key.
 */

/** What an item is graded from. */
export type GradeExamInput = {
  prompt: string;
  points: number;
  /** The Exercise's or Problem's solution; null without one. */
  reference: string | null;
  answer: string;
  kcs: Array<{ id: string; name: string; description: string }>;
};

/** The grading of an item, with each result on its KC's id. */
export type ExamGrading = {
  steps: GradedStep[];
  results: Array<{ kcId: string; result: AttemptResult }>;
  /** The Student's final value as written; null without one. */
  finalValue: string | null;
};

const INSTRUCTIONS = `You grade one task of a Student's mock exam for a university course, as its examiner would. You get JSON: the task, the points it is worth, a reference solution (or null), the Student's answer and the knowledge components (KCs) it tests, each under a label.

1. Split the task into the steps the examiner would give points for, and award each step's points in steps of 0.5. The steps' points add up to at most the task's points.
2. Give each step a one-sentence reason the Student can learn from: what was right, or what was missing or wrong. Address the Student as "you".
3. Grade from the reference solution when there is one; an equally valid other approach earns the same points. Without one, grade from the task statement and your own solution.
4. Follow-on errors: a step that correctly uses a wrong earlier result loses no further points.
5. For each KC label, give full when the answer shows the KC applied correctly, partial when partly, wrong when not or not at all.
6. finalValue is the Student's final numeric result as they wrote it, with its unit, such as "17.5 kN"; null when the answer has no final number.`;

const RESULTS = ["full", "partial", "wrong"] as const;

/** The KC labels the call reads: K1, K2, … */
const label = (index: number) => `K${index + 1}`;

/** The call for one item and how to read its grading. */
export function gradeExamCall(input: GradeExamInput) {
  const schema = z.object({
    steps: z
      .array(
        z.object({
          points: z.number().min(0).describe("Points for the step, in 0.5s."),
          reason: z.string().trim().min(1).max(1_000),
        }),
      )
      .min(1)
      .max(20),
    results: z.object(
      Object.fromEntries(
        input.kcs.map((_, index) => [label(index), z.enum(RESULTS)]),
      ),
    ),
    finalValue: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .describe("The Student's final value with its unit; null without one."),
  });
  const kcs = input.kcs.map((kc, index) => ({
    label: label(index),
    name: kc.name,
    description: kc.description,
  }));
  return {
    call: {
      ...aiTask("grade_exam"),
      reasoning: "medium" as const,
      instructions: INSTRUCTIONS,
      output: Output.object({ schema }),
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                task: input.prompt,
                points: input.points,
                referenceSolution: input.reference,
                answer: input.answer,
                kcs,
              }),
            },
          ],
        },
      ] as ModelMessage[],
    },
    /** The model's output as a grading; throws when it is no valid one. */
    grading(output: unknown): ExamGrading {
      const parsed = schema.parse(output);
      const results = parsed.results as Record<string, AttemptResult>;
      return {
        steps: parsed.steps,
        results: input.kcs.map((kc, index) => ({
          kcId: kc.id,
          result: results[label(index)]!,
        })),
        finalValue: parsed.finalValue || null,
      };
    },
  };
}
