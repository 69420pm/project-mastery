import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/** An exercise or solution the content-matching call is offered. */
export type OfferedChunk = {
  /** Short and only for the call, such as e1 or s1. */
  id: string;
  number: string | null;
  markdown: string;
};

/**
 * What the content-matching call returns for these exercise and solution
 * ids. The ids are enums, so the model can only name chunks it was offered;
 * that each exercise gets at most one solution is checked in code.
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
            .describe("The solution that solves this exercise."),
        }),
      )
      .describe(
        "One pair per exercise that one of the solutions solves. Leave out exercises without a solution.",
      ),
  });
}

const PAIRING_INSTRUCTIONS = `You get exercises and solutions from the materials of one university course, as JSON: each with its id, its number as printed (or null) and its Markdown. Their numbers did not match up, for example because two sheets reuse the same numbers or a number is missing.

- Pair each exercise with the solution that solves it, by what they say: the task, its quantities, formulas and wording.
- A solution may solve several exercises, such as all subtasks of one exercise.
- Leave out an exercise when no solution clearly solves it. Do not guess.`;

/**
 * Call settings for pairing's content-matching call (task `ingest`):
 *
 *   generateText({ ...contentPairingSettings(e, s), messages: contentPairingMessages(e, s) })
 */
export function contentPairingSettings(
  exercises: readonly [OfferedChunk, ...OfferedChunk[]],
  solutions: readonly [OfferedChunk, ...OfferedChunk[]],
) {
  const ids = (chunks: readonly [OfferedChunk, ...OfferedChunk[]]) =>
    chunks.map((chunk) => chunk.id) as [string, ...string[]];
  return {
    ...aiTask("ingest"),
    instructions: PAIRING_INSTRUCTIONS,
    output: Output.object({
      schema: contentPairingSchema(ids(exercises), ids(solutions)),
    }),
  };
}

/** The user message of a content-matching call: both lists, as JSON. */
export function contentPairingMessages(
  exercises: readonly OfferedChunk[],
  solutions: readonly OfferedChunk[],
) {
  const text = JSON.stringify({ exercises, solutions });
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text }],
    },
  ];
}
