import "server-only";
import { Output } from "ai";
import { z } from "zod";
import {
  HEADING_STYLES,
  PAGE_SKIP_REASONS,
  UNIT_LABELS,
} from "@/features/ingestion/types";
import { aiTask } from "@/lib/ai/models";

/** One unit of a page batch, in reading order. */
const batchUnitSchema = z.object({
  markdown: z
    .string()
    .describe(
      "The unit's content as Markdown in the page's language. Formulas in LaTeX ($...$ inline, $$...$$ display). A plot, chart or drawing as a blockquote starting with **Figure:** that describes it. A heading's text verbatim, without Markdown heading marks.",
    ),
  label: z.enum(UNIT_LABELS),
  pageFrom: z.number().int().describe("The page number the unit starts on."),
  pageTo: z.number().int().describe("The page number the unit ends on."),
  style: z
    .enum(HEADING_STYLES)
    .nullable()
    .describe(
      "For a heading: title (the largest on its page or a slide title), large (set larger than the text) or bold (text size, bold). Else null.",
    ),
  continuesFromPreviousBatch: z
    .boolean()
    .describe(
      "Only for the first unit: it starts mid-way, going on from before these pages (the context unit, when given).",
    ),
  continuesOnNextBatch: z
    .boolean()
    .describe(
      "Only for the last unit: it is cut off at the end of the last page and goes on after it.",
    ),
});

/** What one page batch call returns. */
export const batchResultSchema = z.object({
  units: z.array(batchUnitSchema),
  skippedPages: z
    .array(
      z.object({
        pageNumber: z.number().int(),
        reason: z.enum(PAGE_SKIP_REASONS),
      }),
    )
    .default([])
    .describe(
      "Every page of the batch that has no unit, with the reason: titles_or_contents for a page of only a title, a table of contents, an index or a reference list. A page with units is not listed.",
    ),
});

/** The units of a stored page result: those that start on that page. */
export const storedUnitsSchema = z.array(batchUnitSchema);

/** One unit of a page batch, as stored. */
export type PageUnit = z.infer<typeof batchUnitSchema>;

const BATCH_INSTRUCTIONS = `You transcribe consecutive pages of a Student's course material (slides, a script, an exercise sheet, a solution sheet or an old exam) into ordered units.

- Each page comes as its number, its image and, when it has one, its text layer. The image is the source. Use the text layer to get words and symbols right, but it may be out of order and garbles formulas: where it disagrees with the image, the image wins.
- A unit is the longest run of one label under one heading. Definitions, theorems, proofs, examples and remarks stay inside their content unit; they are not headings.
- Every line that looks like a heading (a title, a numbered section, a slide title, a bold line on its own) is its own heading unit, copied verbatim with its number. Give its style.
- An exercise with all its subtasks is one exercise unit; its solution is one solution unit.
- Label each unit:
  - heading: a title or section heading.
  - exercise: a task for the Student. A result printed for checking, such as "Result for checking: 8 solutions", stays in its exercise's unit.
  - solution: only the answer to an exercise or exam problem, never a proof in teaching text.
  - admin: everything about the course or the exam rather than the subject: organisation, schedule and dates, lecturers and contacts, grading, requirements for admission or credit, the exam's format, duration, allowed aids and what it covers, literature recommendations, motivation for the course, and an overview of what the course will cover.
  - content: what the Student has to learn to understand the subject and solve its exercises: definitions, theorems, proofs, examples, explanations, methods and remarks.
- Decide admin or content by asking: could an exam question be asked about this text's subject matter? If yes, it is content. If it only describes the course, its organisation or the exam, it is admin, even when it sits on a slide next to subject matter or uses subject terms, such as an agenda listing the chapters. When a slide or section mixes both, make a separate unit for each.
- Write each unit as Markdown in the page's own language. Do not translate, summarize or solve anything.
- Write every formula in LaTeX: $...$ inline, $$...$$ for display.
- Describe a plot, chart or technical drawing inside its unit as a blockquote that starts with **Figure:**, saying what it shows. Leave out decorative images such as logos.
- Do not transcribe running headers, footers, page numbers, logos, title pages, tables of contents, indexes or reference lists. A page with nothing else has no units: list it in skippedPages with its reason. Every page of the batch either has units or is listed there.
- Give each unit the page it starts on and the page it ends on. A unit may run over several of these pages.
- When the context unit from before these pages is given, do not transcribe it again. Mark the first unit when it starts mid-way and goes on from before these pages, and the last unit when it is cut off at the end of the last page.`;

/**
 * Call settings for one page batch call of a parse (task `ingest`),
 * streamed so the Gateway's headers arrive before Node's 5-minute timeout:
 *
 *   streamText({ ...batchCallSettings(), messages: batchMessages(pages, context) })
 */
export function batchCallSettings() {
  return {
    ...aiTask("ingest"),
    // With reasoning on, a model (MiMo observed) can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    maxOutputTokens: 16000,
    instructions: BATCH_INSTRUCTIONS,
    output: Output.object({ schema: batchResultSchema }),
  };
}

/** A page of a batch: its number, image and text layer, if any. */
export type BatchPage = {
  pageNumber: number;
  image: Uint8Array;
  mediaType: string;
  text: string | null;
};

/**
 * The user message of a batch call: the last unit before the batch as
 * context, if any, then each page's number, image and text layer.
 */
export function batchMessages(
  pages: readonly BatchPage[],
  context: Pick<PageUnit, "label" | "markdown"> | null,
) {
  const intro = context
    ? [
        {
          type: "text" as const,
          text: `Context, the last unit before these pages (${context.label}), not to transcribe again:\n\n${context.markdown}`,
        },
      ]
    : [];
  return [
    {
      role: "user" as const,
      content: [
        ...intro,
        ...pages.flatMap((page) => [
          { type: "text" as const, text: `Page ${page.pageNumber}` },
          {
            type: "file" as const,
            data: page.image,
            mediaType: page.mediaType,
          },
          ...(page.text?.trim()
            ? [
                {
                  type: "text" as const,
                  text: `Page ${page.pageNumber}'s text layer, possibly out of order:\n\n${page.text.trim()}`,
                },
              ]
            : []),
        ]),
      ],
    },
  ];
}
