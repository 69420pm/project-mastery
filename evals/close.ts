import { generateText } from "ai";
import { z } from "zod";
import {
  buildCloseInput,
  closeCall,
  keepsPinnedLines,
} from "@/features/study/server";
import type { EvalDefinition } from "./eval";

/**
 * The `close` task (#187): one call per session, as `writeSessionClose` runs
 * it, without a database. The call's own notes are scored before the pinned-
 * line guard, since the guard would hide a model that drops a pin. 3
 * sessions on the jet-engines gold course:
 *
 * - a Student who states a study preference and makes the same error twice:
 *   the Topic note names the error, and a Memory line or the Topic note
 *   records the preference;
 * - a Memory over 3,000 characters with 3 pinned lines: the condensed text
 *   keeps all 3;
 * - an old Topic note that the attempts contradict: the new note no longer
 *   claims the old point.
 *
 * Keyword checks are drafts until the maintainer confirms them. The gate is
 * that all 3 pass.
 */

const input = z.object({
  mode: z.enum(["learn", "review", "practice", "results"]),
  topicName: z.string().nullable(),
  messages: z.array(
    z.object({ role: z.enum(["user", "assistant"]), text: z.string() }),
  ),
  questions: z.array(
    z.object({
      prompt: z.string(),
      answer: z.string().nullable(),
      attempts: z.array(
        z.object({ kcName: z.string(), result: z.string(), help: z.string() }),
      ),
    }),
  ),
  topicNote: z.string().nullable(),
  /** The Memory's lines, joined by line breaks. */
  memoryLines: z.array(z.string()),
});

const expectedOutput = z.object({
  /** "draft" until the maintainer confirms the keywords. */
  labelStatus: z.enum(["draft", "confirmed"]),
  /** The Topic note must contain one of these (case aside); empty: no check. */
  errorKeywords: z.array(z.string()),
  /** A Memory line or the Topic note must contain one of these. */
  preferenceKeywords: z.array(z.string()),
  /** The condensed Memory must keep every pinned line. */
  keepsPins: z.boolean(),
  /** Regular expressions the Topic note must not match (case aside). */
  staleClaims: z.array(z.string()),
});

type Input = z.infer<typeof input>;
type Expected = z.infer<typeof expectedOutput>;

/** What the task returns: the call's notes as JSON, and its Memory. */
const notesSchema = z.object({
  sessionNote: z.string(),
  topicNote: z.string().nullable(),
  memoryLines: z.array(z.string()),
  condensedMemory: z.string().nullable(),
});

async function closeTask(item: Input): Promise<string> {
  const closeInput = buildCloseInput({
    mode: item.mode,
    topicName: item.topicName,
    messages: item.messages.map(({ role, text }) => ({
      role,
      parts: [{ type: "text", text }],
    })),
    questions: item.questions,
    topicNote: item.topicNote,
    memory: item.memoryLines.join("\n"),
  });
  if (!closeInput) throw new Error("The item has no Student message.");
  const { call, notes } = closeCall(closeInput);
  const result = await generateText(call);
  return JSON.stringify(notes(result.output));
}

const includesAny = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.toLowerCase().includes(keyword));

/** The checks one item's labels ask for, each true or false. */
export function scoreClose(
  item: Input,
  output: string,
  expected: Expected,
): Array<{ name: string; ok: boolean }> {
  const notes = notesSchema.parse(JSON.parse(output));
  const topicNote = notes.topicNote ?? "";
  const checks: Array<{ name: string; ok: boolean }> = [];
  if (expected.errorKeywords.length > 0) {
    checks.push({
      name: "topic note names the error",
      ok: includesAny(topicNote, expected.errorKeywords),
    });
  }
  if (expected.preferenceKeywords.length > 0) {
    checks.push({
      name: "preference recorded",
      ok: includesAny(
        [...notes.memoryLines, topicNote].join("\n"),
        expected.preferenceKeywords,
      ),
    });
  }
  if (expected.keepsPins) {
    checks.push({
      name: "condensed memory keeps the pins",
      ok:
        notes.condensedMemory !== null &&
        keepsPinnedLines(item.memoryLines.join("\n"), notes.condensedMemory),
    });
  }
  for (const claim of expected.staleClaims) {
    checks.push({
      name: `topic note drops the old claim /${claim}/`,
      ok: topicNote !== "" && !new RegExp(claim, "i").test(topicNote),
    });
  }
  return checks;
}

export const closeEval: EvalDefinition<Input, Expected> = {
  name: "close",
  input,
  expectedOutput,
  task: closeTask,
  evaluators: [
    async ({ input: item, output, expectedOutput: expected }) => {
      const checks = scoreClose(item, output, expected!);
      const failed = checks.filter(({ ok }) => !ok);
      return [
        {
          name: "pass",
          value: failed.length === 0 ? 1 : 0,
          comment:
            failed.length === 0
              ? `${checks.length} checks passed`
              : `failed: ${failed.map(({ name }) => name).join("; ")}`,
        },
      ];
    },
  ],
  gates: ["pass"],
  // All 3 items must pass.
  minPassRate: 1,
};
