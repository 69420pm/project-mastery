import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { offeredId } from "@/features/knowledge-map/ai/offered-id";
import { aiTask } from "@/lib/ai/models";

/** What the exercise call gets of one exercise unit. */
export type OfferedExerciseUnit = {
  material: string;
  /**
   * The Material's Outline: one line per Chapter, indented by its depth,
   * the unit's Chapter marked.
   */
  outline: string[];
  /** The course language by name, such as English. */
  language: string;
  subtasks: ReadonlyArray<{
    /** Short and only for the call, such as s1. */
    id: string;
    statement: string;
    /** The paired printed solution; null without one. */
    solution: string | null;
  }>;
  /** The KCs nearest to the unit's statements. */
  kcs: ReadonlyArray<{ id: string; name: string; description: string }>;
};

/**
 * What the exercise call answers for these subtask and KC ids. Any string
 * validates as an id (`offeredId`): code drops an unknown KC id, and a
 * subtask with an unknown id is one the call left out.
 */
export const exerciseExtractionSchema = (
  subtaskIds: readonly string[] = [],
  kcIds: readonly string[] = [],
) =>
  z.object({
    subtasks: z.array(
      z.object({
        id: offeredId(subtaskIds),
        notAnExercise: z
          .boolean()
          .describe(
            "True when it asks nothing of the Student, such as a heading or an instruction for the whole sheet.",
          ),
        kcIds: z
          .array(offeredId(kcIds))
          .describe(
            "The 1 to 6 listed KCs a Student needs to solve it, most important first.",
          ),
        newKcs: z
          .array(
            z.object({
              name: z.string().describe("Short, in the course language."),
              description: z.string().describe("One line."),
            }),
          )
          .describe(
            "Only when no listed KC fits what it needs: KCs an exam task could test on their own and a Student could learn in one sitting. Usually empty.",
          ),
        finalAnswers: z
          .array(
            z.object({
              label: z
                .string()
                .describe('What it is, such as "Number of solutions".'),
              value: z
                .string()
                .describe(
                  'The printed result as a mathjs expression, such as "12 kg*m/s^2", "[[1, 2], [0, 1]]", "[2, -3]", "n + 1" or "3 + 4i".',
                ),
              anyOrder: z
                .boolean()
                .describe(
                  "True for a list whose order does not matter, such as a set of eigenvalues.",
                ),
            }),
          )
          .describe(
            "Each mathematical final result the statement or the solution prints. Empty when neither prints one, or when the result is not mathematical, such as a proof or a sentence.",
          ),
      }),
    ),
  });

const EXERCISE_INSTRUCTIONS = `You get one unit of a university course's exercises as JSON: the material's name, its outline with the unit's chapters marked, the course language, its subtasks, each with an id, its statement and its printed solution or null, and the knowledge components (KCs) nearest to it, each with an id. Answer for every subtask.

- Give the ids of the 1 to 6 listed KCs a Student needs to solve it, most important first.
- Only when no listed KC fits something it needs, propose a new KC: something an exam task could test on its own and a Student could learn in one sitting, with a short name and a one-line description.
- Copy each final result that the statement or the solution prints, as printed: a result the statement gives for checking, such as "Result: 12 solutions", or the result the printed solution arrives at, such as "so $\\dim W = 3$". Write it as a mathjs expression: a number with its unit ("12 kg*m/s^2"), a vector ("[2, -3]"), a matrix by rows ("[[1, 2], [0, 1]]"), a complex number ("3 + 4i") or an expression in the statement's symbols ("n + 1"). Mark a list whose order does not matter, such as a set of eigenvalues, as any order. Give none for a result that is not mathematical, such as a proof or a sentence, and none when neither prints one: do not solve anything yourself.
- Mark a subtask that asks nothing of the Student, such as a heading or an instruction for the whole sheet, as not an exercise.
- Write every name and description in the course language. Formulas in LaTeX ($...$).`;

/**
 * Call settings for the extraction of one exercise unit (task `exercise`),
 * with reasoning on; it copies and matches, it does not solve.
 *
 *   streamText({ ...exerciseExtractionSettings(unit), messages: exerciseExtractionMessages(unit) })
 */
export function exerciseExtractionSettings(part: OfferedExerciseUnit) {
  return {
    ...aiTask("exercise"),
    reasoning: "high" as const,
    instructions: EXERCISE_INSTRUCTIONS,
    output: Output.object({
      schema: exerciseExtractionSchema(
        part.subtasks.map((subtask) => subtask.id),
        part.kcs.map((kc) => kc.id),
      ),
    }),
  };
}

/** The user message of an exercise call: the unit, as JSON. */
export function exerciseExtractionMessages(part: OfferedExerciseUnit) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(part) }],
    },
  ];
}
