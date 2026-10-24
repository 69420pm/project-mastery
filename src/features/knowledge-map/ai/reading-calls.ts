import { Output } from "ai";
import { z } from "zod";
import type { ReadingCallInput } from "@/features/knowledge-map/domain/reading-input";
import type { ReadingMode } from "@/features/knowledge-map/domain/topic-reading";
import { aiTask } from "@/lib/ai/models";

/**
 * The `reading` calls of a Knowledge map build (#178), two per new Reading
 * section: the mode call picks how the Student reads it, and for an
 * `annotated` or `study_text` mode a writing call writes the notes or the
 * study text. Code checks what they write (`domain/reading-checks.ts`).
 */

const text = (max: number) => z.string().trim().min(1).max(max);

export const modeSchema = z.object({
  mode: z.enum(["original", "annotated", "study_text"]),
  reason: text(300).describe("One line on why this mode."),
});

export const annotationsSchema = z.object({
  notes: z
    .array(
      z.object({
        page: z.number().int().describe("A page of the section."),
        note: text(1000),
      }),
    )
    .min(1),
});

export const studyTextSchema = z.object({
  text: text(20_000).describe("The study text in Markdown."),
});

const INPUT = `You get, as JSON, a Topic of a university course (its name and central question), one section of the course's pages that a Student reads for it (its first and last page), the knowledge components (KCs) the section teaches (name, type, description), and the section's chunks in reading order, each with its pages, label, Markdown (with LaTeX) and a description of its figure, if any.`;

const MODE_INSTRUCTIONS = `You decide how a Student reads one section of a course's pages. ${INPUT}

Pick one mode:
- "original": the Student reads the pages as they are. This is the default: the exam is written from the course's own pages, so keep them whenever they work.
- "annotated": the pages work, but have gaps a Student trips over, such as a skipped step, an undefined symbol or a bare bullet point. Short notes on the pages fill the gaps.
- "study_text": the pages do not work as reading, such as terse slides, fragments or messy notes, so a written text in the course's own notation teaches the KCs better.

Judge three things: coherence (do the pages read as one line of thought), completeness for the KCs (do they explain what the KCs need), and legibility (can a Student follow them alone). Choose "original" unless one of them clearly fails. Give the mode and one line on why.`;

const ANNOTATED_INSTRUCTIONS = `You annotate one section of a course's pages for a Student who reads them as they are. ${INPUT} You also get the mode and why it was chosen.

Write notes, each on one page of the section by its page number. Each note fills one gap on that page: a skipped step, an undefined symbol, a missing link between ideas or to a KC. Do not repeat what the page says. Keep the course's notation, with inline LaTeX in $...$. One to three sentences per note.`;

const STUDY_TEXT_INSTRUCTIONS = `You write a study text that replaces one section of a course's pages for a Student. ${INPUT} You also get the mode and why it was chosen.

Write Markdown of roughly 400 to 900 words that teaches the section's KCs from its chunks:
- Keep the course's notation, definitions and key formulas word for word, with LaTeX in $...$ or $$...$$.
- Keep the worked examples and derivations, with their steps.
- End every paragraph with a citation of the pages it comes from, "[p. N]" or "[pp. N–M]", using only the section's pages. A list ends with the citation after its last item; display math goes inside a cited paragraph or right before one.
- Add nothing the pages do not say, except in a blockquote starting with "> **Beyond the course:**", which needs no citation. Use it rarely.`;

/** What a call answers, by its output schema. */
const call = (
  instructions: string,
  schema: z.ZodType,
  input: Record<string, unknown>,
) => ({
  ...aiTask("reading"),
  // With reasoning on, MiMo can answer a structured output with an empty
  // text (docs/agents/notes/ai-sdk.md).
  reasoning: "none" as const,
  instructions,
  output: Output.object({ schema }),
  messages: [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(input) }],
    },
  ],
});

/** The mode call of a section. */
export function modeCall(input: ReadingCallInput) {
  return call(MODE_INSTRUCTIONS, modeSchema, input);
}

/** The writing call of a section in the `annotated` or `study_text` mode. */
export function writingCall(
  input: ReadingCallInput,
  judged: { mode: Exclude<ReadingMode, "original">; reason: string },
) {
  return judged.mode === "annotated"
    ? call(ANNOTATED_INSTRUCTIONS, annotationsSchema, { ...input, ...judged })
    : call(STUDY_TEXT_INSTRUCTIONS, studyTextSchema, { ...input, ...judged });
}
