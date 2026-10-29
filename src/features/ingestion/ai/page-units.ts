import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { CHUNK_LABELS } from "@/features/ingestion/types";
import { aiTask } from "@/lib/ai/models";

/** One unit of a page, in reading order. */
const pageUnitSchema = z.object({
  markdown: z
    .string()
    .describe(
      "The unit's content as Markdown in the page's language. Formulas in LaTeX ($...$ inline, $$...$$ display). A plot, chart or drawing as a blockquote starting with **Figure:** that describes it.",
    ),
  label: z.enum(CHUNK_LABELS),
  exerciseNumber: z
    .string()
    .nullable()
    .describe(
      "For an exercise or a solution: the number exactly as printed, such as 7.2a, b) or Aufgabe 3. Else null.",
    ),
  continuesFromPreviousPage: z.boolean(),
  continuesOnNextPage: z.boolean(),
});

/** What one page call returns. */
export const pageResultSchema = z.object({
  language: z
    .string()
    .describe("The page's language as a BCP 47 tag, such as de or en."),
  units: z.array(pageUnitSchema),
});

/** The units of a stored page result. */
export const storedUnitsSchema = z.array(pageUnitSchema);

/** One unit of a stored page result. */
export type PageUnit = z.infer<typeof pageUnitSchema>;

const PAGE_INSTRUCTIONS = `You transcribe one page of a Student's course material (slides, a script, an exercise sheet, a solution sheet or an old exam) into ordered units.

- The page image is the source. When the page's text layer is given, use it to get words and symbols right, but it may be out of order and garbles formulas: where it disagrees with the image, the image wins.
- Split the page by its own structure: a slide, a heading section, an exercise subtask, a solution. Not by length. Give each exercise subtask its own unit; a statement shared by the subtasks is its own unit before them.
- Write each unit's content as Markdown in the page's own language. Do not translate, summarize or solve anything. Keep headings as Markdown headings.
- Write every formula in LaTeX: $...$ inline, $$...$$ for display.
- Describe a plot, chart or technical drawing inside its unit as a blockquote that starts with **Figure:**, saying what it shows. Leave out decorative images such as logos.
- Do not transcribe running headers, footers, page numbers, logos, title pages, tables of contents, indexes or reference lists. A page with nothing else has no units.
- Label each unit: exercise (a task for the Student), solution (a worked solution or answer to an exercise), admin (organisational content only: dates, format, admission, allowed aids, what is examined), or content (everything else).
- For an exercise or a solution, give its number exactly as printed, such as 7.2a or b). A result printed for checking, such as "Result for checking: 8 solutions", stays in its exercise's unit.
- Mark a unit that continues from the previous page or on the next page.
- Give the page's language as a BCP 47 tag.`;

/**
 * Call settings for one page call of a parse (task `ingest`):
 *
 *   generateText({ ...pageCallSettings(), messages: pageMessages(image, mediaType, text) })
 */
export function pageCallSettings() {
  return {
    ...aiTask("ingest"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    maxOutputTokens: 8000,
    instructions: PAGE_INSTRUCTIONS,
    output: Output.object({ schema: pageResultSchema }),
  };
}

/**
 * The user message of a page call: the page image and, when the PDF has a
 * text layer on the page, its text as a hint.
 */
export function pageMessages(
  image: Uint8Array,
  mediaType: string,
  text: string | null,
) {
  const hint = text?.trim()
    ? [
        {
          type: "text" as const,
          text: `The page's text layer, possibly out of order:\n\n${text.trim()}`,
        },
      ]
    : [];
  return [
    {
      role: "user" as const,
      content: [{ type: "file" as const, data: image, mediaType }, ...hint],
    },
  ];
}
