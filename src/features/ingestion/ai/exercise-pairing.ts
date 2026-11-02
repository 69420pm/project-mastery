import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/** What the pairing call returns: pairs of offered ids. */
export const pairingAnswerSchema = z.object({
  pairs: z
    .array(
      z.object({
        exerciseId: z.string().describe("An exercise's id, such as e3."),
        solutionId: z
          .string()
          .describe("The id of the solution that solves it, such as s2."),
      }),
    )
    .describe(
      "Only the pairs you are sure of. Leave out an exercise whose solution is not among the given ones.",
    ),
});

/** An exercise or solution chunk as the pairing call sees it. */
export type PairingItem = {
  /** Short and only for the call, such as e1 or s1. */
  id: string;
  material: string;
  /** Its Chapter path, such as "4 Vector Spaces > 4.2 Subspaces". */
  chapter: string;
  /** Its first characters. */
  text: string;
};

/** How much of each chunk the pairing call sees, in characters. */
export const PAIRING_TEXT_CHARS = 300;

const PAIRING_INSTRUCTIONS = `You pair exercises with their solutions across the materials of one university course: exercise sheets, solution sheets, lecture notes with exercises, old exams with their solutions.

- You get every exercise and every solution as JSON: its id, its material's name, its chapter path and the start of its text.
- Pair an exercise with the solution that solves it. Printed numbers, material names, chapter paths and what the texts say all tell: numbers repeat across sheets, chapters and exams, so a number matches only within the same sheet, chapter or exam, or between an exercise sheet and its solution sheet.
- A solution may solve several exercises, such as the parts of one exercise given apart.
- Give only the pairs you are sure of. An exercise whose solution is not among the given ones gets no pair. Do not guess.`;

/**
 * Call settings for a pairing call (task `ingest`), streamed so a long
 * reasoning does not hit Node's 5-minute headers timeout:
 *
 *   streamText({ ...pairingCallSettings(), messages: pairingMessages(e, s) })
 */
export function pairingCallSettings() {
  return {
    ...aiTask("ingest"),
    reasoning: "high" as const,
    maxOutputTokens: 32000,
    instructions: PAIRING_INSTRUCTIONS,
    output: Output.object({ schema: pairingAnswerSchema }),
  };
}

/** The user message of a pairing call: both lists, as JSON. */
export function pairingMessages(
  exercises: PairingItem[],
  solutions: PairingItem[],
) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ exercises, solutions }),
        },
      ],
    },
  ];
}
