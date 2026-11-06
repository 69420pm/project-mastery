import { Output, type ModelMessage } from "ai";
import { z } from "zod";
import type { CloseInput, CloseNotes } from "@/features/study/domain/close";
import { aiTask } from "@/lib/ai/models";

/**
 * The one model call that closes an ended Study session (task `close`,
 * #187): up to 3 Memory lines and, once the Memory is long, a condensed
 * Memory.
 */

const INSTRUCTIONS = `You keep the notes of an AI tutor for a university course. A Student's study session just ended. You get JSON: the transcript of the session (student and tutor), the questions the tutor asked with the Student's answers and each attempt's result per knowledge component (KC) and the help given, and the Memory, the tutor's notes about this Student for the whole course.

Write:
1. memoryLines: 0 to 3 new lines for the Memory, each at most 200 characters, without a date. Only the Student's preferences and context (how they like to study, their schedule, their exam situation), never what they know or can do. Leave out what the Memory already says. Usually there is nothing new: give none.
2. condensedLines: only when condensesMemory is true, the Memory rewritten to at most half its length as a list with one entry per line: merge repeats into one entry, drop what is outdated, keep the dates where useful. Plain text only. Otherwise null.

Rules for the notes:
- Never claim mastery: no "has mastered", "knows", "understands fully".
- Write for the tutor of a later session, plainly and specifically. No praise.`;

const schema = z.object({
  memoryLines: z.array(z.string().trim().min(1).max(200)).max(3),
  // An array: a model asked for line breaks inside one text glued the lines
  // together.
  condensedLines: z.array(z.string().trim().min(1).max(300)).max(60).nullable(),
});

/** The call for one session and how to read its notes. */
export function closeCall(input: CloseInput) {
  return {
    call: {
      ...aiTask("close"),
      instructions: INSTRUCTIONS,
      output: Output.object({ schema }),
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: JSON.stringify(input) }],
        },
      ] as ModelMessage[],
    },
    /**
     * The model's output as the session's notes, a condensed Memory only
     * when it was asked for; throws when it is no valid output.
     */
    notes(output: unknown): CloseNotes {
      const parsed = schema.parse(output);
      return {
        memoryLines: parsed.memoryLines,
        condensedMemory:
          input.condensesMemory && parsed.condensedLines
            ? parsed.condensedLines.join("\n")
            : null,
      };
    },
  };
}
