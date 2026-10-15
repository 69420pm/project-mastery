import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { boxSchema } from "@/features/ingestion/domain/figure-box";
import { CHUNK_LABELS } from "@/features/ingestion/types";
import { aiTask } from "@/lib/ai/models";

/** One structural unit of a page, in reading order. */
export const pageUnitSchema = z.object({
  markdown: z
    .string()
    .describe(
      "The unit's content as Markdown in the page's language. Formulas in LaTeX ($...$ inline, $$...$$ display). Flowcharts, trees and hierarchies as a ```mermaid code block.",
    ),
  label: z.enum(CHUNK_LABELS),
  exerciseNumber: z
    .string()
    .nullable()
    .describe("The exercise's number as printed, such as 7.2a, or null."),
  points: z
    .number()
    .nullable()
    .describe("The points the exercise is worth, or null."),
  figure: z
    .object({
      description: z
        .string()
        .describe(
          "What the plot or drawing shows: axes, curves, labeled points and what it means.",
        ),
      box: boxSchema
        .nullable()
        .describe("Where the figure is on the page, normalized 0 to 1."),
    })
    .nullable()
    .describe(
      "A plot, chart or technical drawing in this unit, or null. Decorative images such as logos are left out entirely.",
    ),
  continuesFromPreviousPage: z.boolean(),
  continuesOnNextPage: z.boolean(),
});

/** What one page call returns. */
export const pageResultSchema = z.object({ units: z.array(pageUnitSchema) });

export type PageUnit = z.infer<typeof pageUnitSchema>;

/** The units of a stored page result: a page call's, with usable boxes. */
export const storedUnitsSchema = z.array(pageUnitSchema);

const PAGE_INSTRUCTIONS = `You transcribe one page of a Student's course material (slides, a script, an exercise sheet, a solution sheet or an old exam) into ordered units.

- Split the page by its own structure: a slide, a heading section, a definition, an example, an exercise or subtask, a solution. Not by length.
- Write each unit's content as Markdown in the page's own language. Do not translate or summarize.
- Write every formula in LaTeX: $...$ inline, $$...$$ for display.
- Write flowcharts, trees and hierarchies as a Mermaid code block.
- Label each unit: content, definition, example, exercise, solution, figure, or admin (organizational remarks such as "not exam-relevant" or "closed-book exam").
- For an exercise, give its number as printed and its points, if shown.
- For a plot, chart or technical drawing, give a figure with a description and its box on the page. Leave out decorative images such as logos.
- Mark a unit that starts on an earlier page or continues on the next page.
- A page without content (blank, or only a logo) still gets one admin unit that says so.`;

/**
 * Call settings for one page call of a parse (task `ingest`):
 *
 *   generateText({ ...pageCallSettings(), messages: pageMessages(image, mediaType) })
 */
export function pageCallSettings() {
  return {
    ...aiTask("ingest"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: PAGE_INSTRUCTIONS,
    output: Output.object({ schema: pageResultSchema }),
  };
}

/** The user message of a page call: the page image alone. */
export function pageMessages(image: Uint8Array, mediaType: string) {
  return [
    {
      role: "user" as const,
      content: [{ type: "file" as const, data: image, mediaType }],
    },
  ];
}
