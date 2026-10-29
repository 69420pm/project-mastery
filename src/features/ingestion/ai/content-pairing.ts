import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/** A solution the content-matching call is offered. */
export type OfferedSolution = {
  /** Short and only for the call, such as s1. */
  id: string;
  number: string | null;
  markdown: string;
};

/** An exercise the content-matching call is offered, with its candidates. */
export type OfferedExercise = OfferedSolution & {
  /** The ids of the solutions it may be paired with. */
  candidates: string[];
};

/**
 * What the content-matching call returns for these exercise and solution
 * ids. The ids are enums, so the model can only name chunks it was offered;
 * that each exercise gets at most one of its candidates is checked in code.
 */
export function contentPairingSchema(
  exerciseIds: readonly [string, ...string[]],
  solutionIds: readonly [string, ...string[]],
) {
  return z.object({
    pairs: z
      .array(
        z.object({
          exerciseId: z.enum(exerciseIds),
          solutionId: z
            .enum(solutionIds)
            .describe("The candidate that solves this exercise."),
        }),
      )
      .describe(
        "One pair per exercise that one of its candidates solves. Leave out exercises without a solution.",
      ),
  });
}

const PAIRING_INSTRUCTIONS = `You get exercises and solutions from the materials of one university course, as JSON: each with its id, its number as printed (or null) and its Markdown, and each exercise with the ids of its candidate solutions. Their numbers did not settle the pairs: the candidates may come from several sources, numbers repeat across sheets, and some are missing.

- Pair each exercise with the candidate that solves it, by what they say: the task, its quantities, formulas and wording.
- A solution may solve several exercises, such as all subtasks of one exercise.
- Leave out an exercise when none of its candidates clearly solves it. Do not guess.`;

const ids = (chunks: readonly [{ id: string }, ...Array<{ id: string }>]) =>
  chunks.map((chunk) => chunk.id) as [string, ...string[]];

/**
 * Call settings for one batch of pairing's content-matching call (task
 * `ingest`):
 *
 *   generateText({ ...contentPairingSettings(e, s), messages: contentPairingMessages(e, s) })
 */
export function contentPairingSettings(
  exercises: readonly [OfferedExercise, ...OfferedExercise[]],
  solutions: readonly [OfferedSolution, ...OfferedSolution[]],
) {
  return {
    ...aiTask("ingest"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: PAIRING_INSTRUCTIONS,
    output: Output.object({
      schema: contentPairingSchema(ids(exercises), ids(solutions)),
    }),
  };
}

/** The user message of a content-matching call: both lists, as JSON. */
export function contentPairingMessages(
  exercises: readonly OfferedExercise[],
  solutions: readonly OfferedSolution[],
) {
  const text = JSON.stringify({ exercises, solutions });
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text }],
    },
  ];
}
