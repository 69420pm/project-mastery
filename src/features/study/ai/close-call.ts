import { Output, type ModelMessage } from "ai";
import { z } from "zod";
import type { CloseInput, CloseNotes } from "@/features/study/domain/close";
import { aiTask } from "@/lib/ai/models";

/**
 * The one model call that closes an ended Study session (task `close`,
 * #187): its Session note, its Topic's new Topic note, up to 3 Memory lines
 * and, once the Memory is long, a condensed Memory.
 */

const INSTRUCTIONS = `You keep the notes of an AI tutor for a university course. A Student's study session just ended. You get JSON: the session's mode (learn, review, practice or results), its Topic (or null), the transcript of the session (student and tutor), the questions the tutor asked with the Student's answers and each attempt's result per knowledge component (KC) and the help given, the Topic's current note (or null) and the Memory, the tutor's notes about this Student for the whole course.

Write:
1. happened and next: the session note's two lines, without a label. happened (at most 150 characters): what happened in this session. next (at most 149 characters): what comes next.
2. topicNote: the Topic's new note, replacing the current one, at most 1,500 characters. Only when writesTopicNote is true; otherwise null. Keep what still holds from the current note and add what this session showed.
3. memoryLines: 0 to 3 new lines for the Memory, each at most 200 characters, without a date. Only the Student's preferences and context (how they like to study, their schedule, their exam situation), never what they know or can do. Leave out what the Memory already says. Usually there is nothing new: give none.
4. condensedMemory: only when condensesMemory is true, the Memory rewritten to at most half its length, one entry per line, lines separated by line breaks ("\\n"): merge repeats into one line, drop what is outdated, keep the dates where useful. Lines that start with "!" are pinned: first write each of them, unchanged, character for character, each on its own line, with the "!"; never merge, shorten or leave out a pinned line. Then write the other entries. Write plain text only. Otherwise null.

Rules for the notes:
- Record what clicked, the Student's recurring errors in their own words, and the explanation that worked.
- Never claim mastery: no "has mastered", "knows", "understands fully". Describe what the Student did, not what they are.
- Where the current note and the attempts disagree, the attempts win: correct the note.
- Write for the tutor of a later session, plainly and specifically. No praise.`;

const schema = z.object({
  // Two fields, joined by code: a model asked for one text with a line
  // break often wrote a single line.
  happened: z.string().trim().min(1).max(150),
  next: z.string().trim().min(1).max(149),
  topicNote: z.string().trim().min(1).max(1_500).nullable(),
  memoryLines: z.array(z.string().trim().min(1).max(200)).max(3),
  condensedMemory: z.string().trim().min(1).max(3_000).nullable(),
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
     * The model's output as the session's notes, a Topic note only when the
     * session writes one and a condensed Memory only when it was asked for;
     * throws when it is no valid output.
     */
    notes(output: unknown): CloseNotes {
      const parsed = schema.parse(output);
      return {
        sessionNote: `${parsed.happened}\n${parsed.next}`,
        topicNote: input.writesTopicNote ? parsed.topicNote : null,
        memoryLines: parsed.memoryLines,
        condensedMemory: input.condensesMemory ? parsed.condensedMemory : null,
      };
    },
  };
}
