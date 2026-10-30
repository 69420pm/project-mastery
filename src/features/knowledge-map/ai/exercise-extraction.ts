import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { KC_TYPES } from "@/features/knowledge-map/schemas";
import { offeredId } from "@/features/knowledge-map/ai/offered-id";
import { aiTask } from "@/lib/ai/models";

/** What the exercise call gets of one exercise Part. */
export type OfferedExercisePart = {
  title: string;
  chapterTitle: string;
  /** The Course language, as a BCP 47 tag. */
  language: string;
  subtasks: ReadonlyArray<{
    /** Short and only for the call, such as s1. */
    id: string;
    /** As printed, such as "7.2b"; null without one. */
    number: string | null;
    statement: string;
    /** The paired printed solution; null without one. */
    solution: string | null;
  }>;
  /** The KCs nearest to the Part's statements. */
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
              type: z.enum(KC_TYPES),
            }),
          )
          .describe(
            "Only when no listed KC fits what it needs: KCs one short exam question can test. Usually empty.",
          ),
        finalAnswers: z
          .array(
            z.object({
              label: z.string().describe('What it is, such as "Thrust".'),
              value: z.number().describe("The printed value, as a number."),
              unit: z
                .string()
                .nullable()
                .describe(
                  'Its unit in mathjs notation, such as "kN" or "m/s^2"; null for a pure number.',
                ),
            }),
          )
          .describe(
            "Each numeric final result exactly as printed in its statement (such as a result for checking) or its solution. Empty when none is printed: never compute one.",
          ),
      }),
    ),
  });

const EXERCISE_INSTRUCTIONS = `You get one Part of a university course's exercises as JSON: its title, its chapter, the course language, its subtasks, each with an id, its number as printed, its statement and its printed solution or null, and the knowledge components (KCs) nearest to it, each with an id. Answer for every subtask.

- Give the ids of the 1 to 6 listed KCs a Student needs to solve it, most important first.
- Only when no listed KC fits something it needs, propose a new KC: one thing one short exam question can test, with a short name, a one-line description and its type: fact (a statement to know), concept (an idea to understand), procedure (a method to carry out) or decision (when to use which method).
- Copy each numeric final result exactly as the statement or the solution prints it, with its unit. When neither prints one, leave the final answers empty. Do not solve anything.
- Mark a subtask that asks nothing of the Student, such as a heading or an instruction for the whole sheet, as not an exercise.
- Write every name and description in the course language. Formulas in LaTeX ($...$).`;

/**
 * Call settings for the extraction of one exercise Part (task `exercise`),
 * without reasoning: it copies and matches, it does not solve.
 *
 *   generateText({ ...exerciseExtractionSettings(part), messages: exerciseExtractionMessages(part) })
 */
export function exerciseExtractionSettings(part: OfferedExercisePart) {
  return {
    ...aiTask("exercise"),
    reasoning: "none" as const,
    instructions: EXERCISE_INSTRUCTIONS,
    output: Output.object({
      schema: exerciseExtractionSchema(
        part.subtasks.map((subtask) => subtask.id),
        part.kcs.map((kc) => kc.id),
      ),
    }),
  };
}

/** The user message of an exercise call: the Part, as JSON. */
export function exerciseExtractionMessages(part: OfferedExercisePart) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(part) }],
    },
  ];
}
