import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { KC_TYPES } from "@/features/knowledge-map/schemas";
import { offeredId } from "@/features/knowledge-map/ai/offered-id";
import { aiTask } from "@/lib/ai/models";

/** A chunk the extraction call is offered. */
export type OfferedChunk = {
  /** Short and only for the call, such as c1. */
  id: string;
  markdown: string;
};

/** What the extraction call gets of one teaching Part. */
export type OfferedPart = {
  title: string;
  chapterTitle: string;
  /** The Course language, as a BCP 47 tag. */
  language: string;
  /** How many KCs it is asked for. */
  kcBudget: number;
  chunks: readonly [OfferedChunk, ...OfferedChunk[]];
};

/**
 * What the extraction call returns for a Part with these chunk ids. Any
 * string validates as an id (`offeredId`): code drops a KC without a known
 * chunk id, and a Prerequisite with an unknown end.
 */
export const partExtractionSchema = (chunkIds: readonly string[] = []) =>
  z.object({
    kcs: z.array(
      z.object({
        name: z.string().describe("Short, in the Course language."),
        description: z
          .string()
          .describe("One line: what it states or how it is done."),
        type: z.enum(KC_TYPES),
        chunkIds: z
          .array(offeredId(chunkIds))
          .describe("The chunks that teach it, at least one."),
        assumes: z
          .array(z.string())
          .describe(
            "Up to 3 names of things it uses that this Part does not explain. Empty when none.",
          ),
      }),
    ),
    prerequisites: z
      .array(
        z.object({
          from: z.string().describe("The name of the KC learned first."),
          to: z.string().describe("The name of the KC that builds on it."),
        }),
      )
      .describe(
        "Pairs of this Part's KCs where the text shows that one builds on the other.",
      ),
  });

const EXTRACTION_INSTRUCTIONS = `You get one Part of a university course's materials as JSON: its title, its chapter, the course language, a KC budget and its chunks, each with an id and its Markdown. List the knowledge components (KCs) this Part teaches.

- A KC is one thing the Part teaches that one short exam question can test. Its type is fact (a statement to know), concept (an idea to understand), procedure (a method to carry out) or decision (when to use which method).
- Together, the Part's KCs cover what it teaches, in at most the KC budget; fewer when the Part teaches less. Do not split one thing into several KCs or merge several into one.
- Headings, summaries, asides, the organisation of the course and repeated material are no KCs.
- Give each KC a short name, a one-line description, its type and the ids of the chunks that teach it.
- For each KC, name up to 3 things it uses that this Part does not explain, such as a concept from an earlier chapter, under assumes.
- List a Prerequisite between two of this Part's KCs, by their names, only where the text shows that the second builds on the first.
- Write every name and description in the course language. Formulas in LaTeX ($...$).`;

/**
 * Call settings for the extraction of one teaching Part (task `map`):
 *
 *   generateText({ ...partExtractionSettings(part), messages: partExtractionMessages(part) })
 */
export function partExtractionSettings(part: OfferedPart) {
  return {
    ...aiTask("map"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: EXTRACTION_INSTRUCTIONS,
    output: Output.object({
      schema: partExtractionSchema(part.chunks.map((chunk) => chunk.id)),
    }),
  };
}

/** The user message of an extraction call: the Part, as JSON. */
export function partExtractionMessages(part: OfferedPart) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(part) }],
    },
  ];
}
