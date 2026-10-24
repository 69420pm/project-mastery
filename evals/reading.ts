import { generateText } from "ai";
import { z } from "zod";
import {
  checkStudyText,
  modeCall,
  modeSchema,
  studyTextSchema,
  writingCall,
} from "@/features/knowledge-map/server";
import type { EvalDefinition } from "./eval";

/**
 * The `reading` calls of stage 2c (#178): how often does the mode call pick
 * the expected reading mode for a Reading section? Each gold section of the
 * jet-engines course comes as parsed, rewritten as terse slides and rewritten
 * as messy notes. The task runs the real mode call on the section as stage 2c
 * sends it. For the cases labelled `study_text`, the evaluator also runs the
 * writing call, checks the text's citations and prints it beside the chunks,
 * to read by hand. The labels are drafts until the maintainer confirms them.
 *
 * Gate over the whole dataset: mode accuracy at least 80%. It is reported,
 * not blocking: evals never run in CI.
 */

const MODES = ["original", "annotated", "study_text"] as const;

const input = z.object({
  topic: z.object({ name: z.string(), centralQuestion: z.string() }),
  section: z.object({ pageFrom: z.number().int(), pageTo: z.number().int() }),
  kcs: z
    .array(
      z.object({ name: z.string(), type: z.string(), description: z.string() }),
    )
    .min(1),
  chunks: z
    .array(
      z.object({
        pageFrom: z.number().int(),
        pageTo: z.number().int(),
        label: z.string(),
        markdown: z.string(),
        figureDescription: z.string().nullable(),
      }),
    )
    .min(1),
});

const expectedOutput = z.object({
  /** "draft" until the maintainer confirms the labels. */
  labelStatus: z.enum(["draft", "confirmed"]),
  mode: z.enum(MODES),
});

type Input = z.infer<typeof input>;
type Expected = z.infer<typeof expectedOutput>;

/** The mode call's answer, as JSON. */
async function readingTask(item: Input): Promise<string> {
  const { output } = await generateText(modeCall(item));
  return JSON.stringify(modeSchema.parse(output));
}

/** What one item adds to the counts of the gate. */
export function scoreReading(output: string, expected: Expected) {
  const { mode } = modeSchema.parse(JSON.parse(output));
  return { correct: mode === expected.mode ? 1 : 0 };
}

/** The writing call's study text, checked, and its chunks, to read by hand. */
async function studyTextReport(item: Input, reason: string) {
  const { output } = await generateText(
    writingCall(item, { mode: "study_text", reason }),
  );
  const { text } = studyTextSchema.parse(output);
  let check = "passed";
  try {
    checkStudyText(text, item.section);
  } catch (error) {
    check = error instanceof Error ? error.message : String(error);
  }
  const chunks = item.chunks
    .map(
      ({ pageFrom, label, markdown }) =>
        `[p. ${pageFrom}, ${label}]\n${markdown}`,
    )
    .join("\n\n");
  const words = text.split(/\s+/).filter(Boolean).length;
  // One write, so concurrent items don't interleave.
  console.info(
    `\n──── ${item.topic.name}: chunks\n${chunks}\n\n──── study text (${words} words, citation check ${check})\n${text}\n`,
  );
  return { passed: check === "passed" ? 1 : 0, check };
}

/** Gate threshold over the whole dataset. */
const MIN_MODE_ACCURACY = 0.8;

type ScoreList = Array<{ name: string; value: unknown }>;

function sum(items: Array<{ evaluations: ScoreList }>, name: string) {
  return items.reduce((total, { evaluations }) => {
    const score = evaluations.find((e) => e.name === name)?.value;
    return total + (typeof score === "number" ? score : 0);
  }, 0);
}

const percent = (part: number, total: number) =>
  total === 0 ? "n/a" : `${((100 * part) / total).toFixed(1)}%`;

/** The gate verdict, with the study texts' citation checks reported. */
export function readingGates(items: Array<{ evaluations: ScoreList }>) {
  const correct = sum(items, "mode_correct");
  const texts = sum(items, "study_text_written");
  const checked = sum(items, "study_text_check");
  const accuracy = items.length === 0 ? 0 : correct / items.length;
  return {
    passed: accuracy >= MIN_MODE_ACCURACY,
    summary: `mode accuracy ${percent(correct, items.length)} (${correct} of ${items.length}; at least ${MIN_MODE_ACCURACY * 100}%, not blocking), study texts passing the citation check ${checked} of ${texts} (reported)`,
  };
}

export const readingEval: EvalDefinition<Input, Expected> = {
  name: "reading",
  input,
  expectedOutput,
  task: readingTask,
  evaluators: [
    async ({ input: item, output, expectedOutput: expected }) => {
      const score = scoreReading(output, expected!);
      const { mode, reason } = modeSchema.parse(JSON.parse(output));
      const scores = [
        {
          name: "mode_correct",
          value: score.correct,
          comment: `given ${mode} (${reason}); expected ${expected!.mode}`,
        },
      ];
      if (expected!.mode !== "study_text") return scores;
      const report = await studyTextReport(item, reason);
      return [
        ...scores,
        { name: "study_text_written", value: 1 },
        {
          name: "study_text_check",
          value: report.passed,
          comment: report.check,
        },
      ];
    },
  ],
  gates: [],
  minPassRate: 0,
  aggregate: readingGates,
};
