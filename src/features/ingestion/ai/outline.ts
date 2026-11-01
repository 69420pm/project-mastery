import "server-only";
import { Output } from "ai";
import { z } from "zod";
import type { ProposedChapter } from "@/features/ingestion/domain/outline";
import { aiTask } from "@/lib/ai/models";

/** What the structure call of a parse returns. */
export const outlineAnswerSchema = z.object({
  language: z
    .string()
    .describe(
      "The language the Material is written in, as an English name such as German or English.",
    ),
  notes: z
    .string()
    .describe(
      "Non-standard notation and conventions of the Material that a reader of a single passage needs, such as vectors written as rows or ⊂ allowing equality. At most 1,000 characters; empty when there are none.",
    ),
  chapters: z
    .array(
      z.object({
        title: z
          .string()
          .describe("The Chapter's title as printed, with its number."),
        level: z
          .number()
          .int()
          .describe(
            "1 for a top-level Chapter, 2 for one inside it, and so on.",
          ),
        heading: z
          .string()
          .nullable()
          .describe("The id of the heading the Chapter starts at, such as h3."),
        page: z
          .number()
          .int()
          .nullable()
          .describe(
            "The page the Chapter starts on, only when it starts at no given heading; else null.",
          ),
        exam: z
          .boolean()
          .describe(
            "True for an old exam, a class test or their solutions; else false.",
          ),
      }),
    )
    .describe("The Chapters in reading order, each after its parent."),
});

/** A structure call's answer, as a parse uses it. */
export type OutlineAnswer = {
  language: string | null;
  notes: string | null;
  chapters: ProposedChapter[];
};

/** A `materials.language` is 2 to 35 characters long. */
const LANGUAGE_CHARS = { min: 2, max: 35 };

/** The longest `materials.notes` gets. */
const MAX_NOTES_CHARS = 1000;

/**
 * A structure call's answer as a parse uses it: a language that does not
 * fit `materials.language` is none, and notes are cut to 1,000 characters.
 */
export function outlineAnswer(
  answer: z.infer<typeof outlineAnswerSchema>,
): OutlineAnswer {
  const language = answer.language.trim();
  return {
    language:
      language.length >= LANGUAGE_CHARS.min &&
      language.length <= LANGUAGE_CHARS.max
        ? language
        : null,
    notes: answer.notes.trim().slice(0, MAX_NOTES_CHARS),
    chapters: answer.chapters,
  };
}

const OUTLINE_INSTRUCTIONS = `You find the Outline of a Student's course material (lecture notes, slides, an exercise sheet, a solution sheet or an old exam): the tree of Chapters it is organised in, as a table of contents lists them.

- You get the Material's name, its page count, its PDF outline when it has one (title, level, page), every line its reader marked as a heading (id, page, style, text) and how each page starts.
- A Chapter is a part, chapter, section or subsection, a slide deck's section, an exercise sheet, or an old exam. Definitions, theorems, lemmas, propositions, corollaries, examples, proofs, remarks, single exercises or problems, figure captions and running headers are never Chapters, even when set as headings.
- Give the Chapters in reading order, each with its title as printed (with its number), its level (1 at the top, 2 inside it, and so on) and where it starts: the id of its heading, or, only when none of the given headings opens it, its first page. Leave out a Chapter that starts on no given page.
- The PDF outline, numbering and heading styles show the levels; a Material may not use every level.
- Mark a Chapter exam when it is an old exam, a class test or their solutions.
- language: the language the Material is written in, as an English name.
- notes: notation and conventions of this Material's content that differ from the usual ones and that a reader of one passage needs. Never its structure, headings or numbering. Empty when there are none.`;

/** A heading unit as the structure call sees it. */
export type OutlineHeading = {
  id: string;
  page: number;
  style: string | null;
  text: string;
};

/** What the structure call reads about a Material. */
export type OutlineInput = {
  name: string;
  pageCount: number;
  pdfOutline: { title: string; level: number; page: number }[];
  headings: OutlineHeading[];
  /** How each read page starts, by the units that start on it. */
  pageStarts: { page: number; text: string }[];
};

/**
 * Call settings for the structure call of a parse (task `ingest`), streamed
 * so a long reasoning does not hit Node's 5-minute headers timeout:
 *
 *   streamText({ ...outlineCallSettings(), messages: outlineMessages(input) })
 */
export function outlineCallSettings() {
  return {
    ...aiTask("ingest"),
    reasoning: "high" as const,
    maxOutputTokens: 32000,
    instructions: OUTLINE_INSTRUCTIONS,
    output: Output.object({ schema: outlineAnswerSchema }),
  };
}

/** The user message of the structure call: the Material as JSON. */
export function outlineMessages(input: OutlineInput) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            material: input.name,
            pages: input.pageCount,
            ...(input.pdfOutline.length > 0
              ? { pdfOutline: input.pdfOutline }
              : {}),
            headings: input.headings,
            pageStarts: input.pageStarts,
          }),
        },
      ],
    },
  ];
}
