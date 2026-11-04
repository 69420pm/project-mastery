import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { offeredId } from "@/features/knowledge-map/ai/offered-id";
import { aiTask } from "@/lib/ai/models";

/** A chunk the extraction call is offered. */
export type OfferedChunk = {
  /** Short and only for the call, such as c1. */
  id: string;
  markdown: string;
};

/** What the extraction call gets of one teaching unit. */
export type OfferedUnit = {
  material: string;
  /**
   * The Material's Outline: one line per Chapter, indented by its depth,
   * the unit's Chapter marked.
   */
  outline: string[];
  /** The course language by name, such as English. */
  language: string;
  chunks: readonly [OfferedChunk, ...OfferedChunk[]];
};

/** The mark on the unit's Chapter in the Outline. */
export const UNIT_MARK = "  <- this unit";

/**
 * What the extraction call returns for a unit with these chunk ids. Any
 * string validates as an id (`offeredId`): code drops a KC without a known
 * chunk id, and a Prerequisite with an unknown end.
 */
export const chapterExtractionSchema = (chunkIds: readonly string[] = []) =>
  z.object({
    kcs: z.array(
      z.object({
        name: z.string().describe("Short, in the course language."),
        description: z
          .string()
          .describe("One line: what it states or how it is done."),
        chunkIds: z
          .array(offeredId(chunkIds))
          .describe("The chunks that teach it, at least one."),
        assumes: z
          .array(
            z.object({
              name: z.string().describe("Short, in the course language."),
              description: z
                .string()
                .describe("One line: what it states or what it is."),
            }),
          )
          .describe(
            "Up to 3 things it uses that this unit does not explain. Empty when none.",
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
        "Pairs of this unit's KCs where the text shows that one builds on the other.",
      ),
  });

const EXTRACTION_INSTRUCTIONS = `You get one unit of a university course's materials as JSON: the material's name, its outline with the unit's chapter marked, the course language and the unit's chunks, each with an id and its Markdown. List the knowledge components (KCs) this unit teaches.

- A KC is one thing the unit teaches that one short exam question can test: a statement to know, an idea to understand, a method to carry out or when to use which method.
- Together, the unit's KCs cover what it teaches. Do not split one thing into several KCs or merge several into one.
- Headings, summaries, asides, the organisation of the course and repeated material are no KCs.
- Give each KC a short name, a one-line description and the ids of the chunks that teach it.
- For each KC, list under assumes up to 3 things it uses that this unit does not explain, from an earlier chapter or from outside the course, each with a short name and a one-line description of what it states or what it is. Leave out everyday knowledge that a university student of this subject cannot lack.
- List a Prerequisite between two of this unit's KCs, by their names, only where the text shows that the second builds on the first.
- Write every name and description in the course language. Formulas in LaTeX ($...$).`;

/**
 * Call settings for the extraction of one teaching unit (task `map`), with
 * reasoning on:
 *
 *   streamText({ ...chapterExtractionSettings(unit), messages: chapterExtractionMessages(unit) })
 */
export function chapterExtractionSettings(unit: OfferedUnit) {
  return {
    ...aiTask("map"),
    reasoning: "high" as const,
    instructions: EXTRACTION_INSTRUCTIONS,
    output: Output.object({
      schema: chapterExtractionSchema(unit.chunks.map((chunk) => chunk.id)),
    }),
  };
}

/** The user message of an extraction call: the unit, as JSON. */
export function chapterExtractionMessages(unit: OfferedUnit) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(unit) }],
    },
  ];
}
