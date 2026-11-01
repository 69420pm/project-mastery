import { Output, type ModelMessage } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/**
 * The one model call of a generated Problem (task `generate`, #183): a
 * variant of an Exercise, or a new Problem for KCs. The model writes the
 * statement and solution with every number as a `{{variable}}` of a mathjs
 * program, which code runs and fills in, so no number is the model's own
 * arithmetic. A draft that fails goes back once with the error
 * (`retryMessages`).
 */

/** The plan's five changes a variant makes, one per variant. */
export const VARIANT_CHANGES = [
  "new_values",
  "different_unknown",
  "reversed",
  "new_scenario",
  "step_added_or_removed",
] as const;

/** A KC as the call reads it. */
type GenerateKc = { name: string; description: string };

/** What a variant is written from: one Exercise of the Course. */
export type VariantInput = {
  kind: "variant";
  exercise: {
    question: string;
    /** Its printed solution; null without one. */
    solution: string | null;
    finalAnswers: Array<{
      label: string;
      value: number;
      unit: string | null;
    }> | null;
    difficulty: number;
  };
  kcs: GenerateKc[];
};

/** What a new Problem is written from. */
export type NewProblemInput = {
  kind: "new";
  /** Each KC with up to 3 of its source chunks' Markdown. */
  kcs: Array<GenerateKc & { sources: string[] }>;
  difficulty: number;
  /** Up to 2 of the Topic's Exercises, for the examiner's style. */
  styleAnchors: Array<{ question: string }>;
};

export type GenerateInput = VariantInput | NewProblemInput;

const INSTRUCTIONS = `You write one practice problem for a university course, as its examiner would, and its worked solution. You get JSON: either an exercise of the course to vary (kind "variant"), or the knowledge components (KCs) a new problem tests with their course sources, a difficulty and exercises of the course as style anchors (kind "new").

A variant keeps the exercise's structure and KCs but makes one change so the remembered answer no longer helps. Pick the one that fits best:
- new_values: new given values; every result is recomputed.
- different_unknown: ask for a different unknown from the same setup.
- reversed: give the result and ask for an input.
- new_scenario: change the scenario but keep the method (another engine stage, another function).
- step_added_or_removed: add or remove one step.

Rules for every problem:
1. Write what the course's examiner would write: their notation, their phrasing, their kind of context, as the exercise or the style anchors show.
2. One clear question; every needed value given; nothing that only tests reading the statement.
3. Test the KCs, not arithmetic stamina; no plug-into-formula problem unless the KC is that procedure.
4. Difficulty: 1 is one KC in one step; 2 is two KCs or several steps; 3 combines KCs in a setup the course does not show. A variant keeps the exercise's difficulty; a new problem has the given one.
5. Physically and mathematically sensible values and results.
6. The solution shows the reasoning step by step, and says when other approaches are equally valid (proofs, derivations).

Numbers come from code, never from your own arithmetic. When the problem has numbers, write a mathjs program: one assignment per line, units inline, such as \`mass_flow = 40 kg/s\`, \`thrust = mass_flow * (600 m/s - 250 m/s)\`, \`thrust_kN = to(thrust, kN)\`. It assigns every given value and computes every intermediate and final result from them. Never name a variable like a unit (m, s, g, N, K, T, J, W, Pa, ...): use mass, time, mass_flow. Convert with to(value, unit); dividing by a unit drops it. In the statement and the solution, write every number, given or computed, as a placeholder {{variable}} of the program, which code replaces with the value at 4 significant figures and its unit: write "the air leaves at {{exit_velocity}}", never the number or the unit yourself. Write no {{ for anything else. List each final answer as the program variable that holds it and the unit it is in, null for a plain number. A problem without numbers, such as a proof or a conceptual question, has program null and no final answers.`;

/** The model's draft of one Problem. */
const draftFields = {
  statement: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe("The problem as the Student reads it, Markdown with LaTeX."),
  solution: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe("The worked solution, step by step, Markdown with LaTeX."),
  program: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .nullable()
    .describe("The mathjs program; null without numbers."),
  finalAnswers: z
    .array(
      z.object({
        variable: z.string().trim().min(1).max(100),
        unit: z.string().trim().min(1).max(50).nullable(),
      }),
    )
    .max(10)
    .describe("Each final result: its program variable and unit."),
};

const variantSchema = z.object({
  change: z
    .enum(VARIANT_CHANGES)
    .describe("The one change this variant makes."),
  ...draftFields,
});

const newProblemSchema = z.object(draftFields);

/** A draft as the workflow checks it. */
export type ProblemDraft = {
  statement: string;
  solution: string;
  program: string | null;
  finalAnswers: Array<{ variable: string; unit: string | null }>;
  /** A variant's change; null for a new Problem. */
  change: (typeof VARIANT_CHANGES)[number] | null;
};

/** The call for one Problem and how to read its draft. */
export function generateCall(input: GenerateInput) {
  const schema: z.ZodType<
    z.infer<typeof variantSchema> | z.infer<typeof newProblemSchema>
  > = input.kind === "variant" ? variantSchema : newProblemSchema;
  return {
    call: {
      ...aiTask("generate"),
      reasoning: "medium" as const,
      instructions: INSTRUCTIONS,
      output: Output.object({ schema }),
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: JSON.stringify(input) }],
        },
      ] as ModelMessage[],
    },
    /** The model's output as a draft; throws when it is no valid one. */
    draft(output: unknown): ProblemDraft {
      const parsed = schema.parse(output);
      return {
        statement: parsed.statement,
        solution: parsed.solution,
        program: parsed.program,
        finalAnswers: parsed.finalAnswers,
        change: "change" in parsed ? parsed.change : null,
      };
    },
  };
}

/**
 * The messages of the retry: the first call's, then the draft as the
 * model's answer and the error that failed it.
 */
export function retryMessages(
  messages: ModelMessage[],
  output: unknown,
  error: string,
): ModelMessage[] {
  return [
    ...messages,
    { role: "assistant", content: JSON.stringify(output) },
    {
      role: "user",
      content: `This draft failed: ${error}\nFix it and answer the whole problem again in the same shape.`,
    },
  ];
}
