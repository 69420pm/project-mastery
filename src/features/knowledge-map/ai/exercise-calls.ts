import { Output } from "ai";
import { z } from "zod";
import { BLOOM_LEVELS, KC_TYPES } from "@/features/knowledge-map/schemas";
import { aiTask } from "@/lib/ai/models";

/**
 * The `exercise` call of a Knowledge map build: one per exercise subtask,
 * with the map's KCs, which answers the KCs the subtask needs, new KCs it
 * needs that the map lacks, a reusable task type, the model's own solution
 * with its numeric final answers and, when a solution was given, whether that
 * one matches.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * What the call answers for every subtask. KC ids and big ideas are plain
 * strings, not enums, so an unknown id is dropped in code instead of failing
 * the call.
 */
export const exerciseAnswerSchema = z.object({
  kcIds: z
    .array(z.string())
    .describe("The ids of the listed KCs a Student needs to solve it."),
  newKcs: z
    .array(
      z.object({
        name: text(200),
        description: text(1000).describe("One line."),
        type: z.enum(KC_TYPES).exclude(["prior"]),
        bloom: z.enum(BLOOM_LEVELS),
        bigIdea: z.string().describe("The id of a listed big idea."),
      }),
    )
    .describe(
      "KCs it needs that no listed KC covers, at the one-short-question grain; usually none.",
    ),
  taskType: text(200).describe(
    'A short reusable label for this kind of task, such as "compute thrust".',
  ),
  solution: text(20_000).describe(
    "Your own worked solution, step by step, in markdown with LaTeX.",
  ),
  finalResult: text(500).describe("Your final result, with its unit."),
  finalAnswers: z
    .array(
      z.object({
        label: text(200).describe('What it is, such as "Thrust".'),
        value: z.number().describe("Your value, as a plain number."),
        unit: z
          .string()
          .nullable()
          .describe(
            'Its unit in mathjs notation, such as "kN", "m/s^2", "kg/s" or "degC"; null for a pure number.',
          ),
      }),
    )
    .max(10)
    .describe(
      "Each numeric final result your solution asks for, one per quantity asked; empty when the subtask asks for no number, such as an explanation or a derivation.",
    ),
  steps: z.int().min(1).max(100).describe("The number of steps you took."),
});

/** What the call also answers when a solution was given. */
export const givenSolutionSchema = z.object({
  givenFinalResult: text(500).describe(
    "The given solution's final result, as printed.",
  ),
  matchesGiven: z
    .boolean()
    .describe("Whether the given final result matches yours."),
});

function exerciseSchema(solutionGiven: boolean) {
  return solutionGiven
    ? exerciseAnswerSchema.extend(givenSolutionSchema.shape)
    : exerciseAnswerSchema;
}

const INSTRUCTIONS = `You analyse one exercise subtask of a university course. You get its markdown, the given solution if there is one, the course's big ideas and knowledge components (KCs) with their ids, and the task types used so far, as JSON. Give the ids of the KCs a Student needs to solve it. If it needs knowledge no listed KC covers, propose it as a new KC under a listed big idea; a KC is right-sized when one short question can test it and nothing else. Label the kind of task with a short task type, and reuse a listed task type when one fits. Solve the subtask yourself, step by step, and give your final result and the number of steps. List each numeric final result as a value with its unit, which a Student's answer is checked against. When a solution is given, give its final result as printed and say whether it matches yours, allowing for rounding.`;

/** One call for one exercise subtask. */
export function exerciseCall(input: {
  exercise: string;
  solution: string | null;
  bigIdeas: Array<{ id: string; name: string }>;
  kcs: Array<{ id: string; name: string; description: string }>;
  taskTypes: string[];
}) {
  const settings = aiTask("exercise");
  return {
    ...settings,
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md). The worked `solution` field holds
    // the working instead.
    reasoning: "none" as const,
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: exerciseSchema(input.solution !== null) }),
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: JSON.stringify(input) }],
      },
    ],
  };
}
