import { tool } from "ai";
import { z } from "zod";
import type {
  ExerciseView,
  KcReading,
  RecordedKc,
} from "@/features/study/types";

/** What `readKcs` takes: KC ids of the Course. */
export const readKcsInputSchema = z.object({
  kcIds: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("The ids of 1 to 8 KCs of this Course."),
});

/** What `findExercises` takes: KC ids of the Course. */
export const findExercisesInputSchema = readKcsInputSchema;

/** What `recordAttempt` takes: the evidence of one problem or review question. */
export const recordAttemptInputSchema = z.object({
  exerciseId: z
    .string()
    .optional()
    .describe(
      "The id of the Exercise from findExercises, when the problem was one; omit it for your own question.",
    ),
  help: z
    .enum(["none", "some", "solution_shown"])
    .describe(
      "How much you helped: none, some (hints or corrections), or solution_shown when you showed or walked through the solution.",
    ),
  kcs: z
    .array(
      z.object({
        kcId: z.string(),
        correct: z
          .boolean()
          .describe("Whether the Student's final answer got this KC right."),
      }),
    )
    .min(1)
    .max(8)
    .describe("The 1 to 8 KCs of this Course the question tested, each once."),
});

/** What `remember` takes: one line for the Memory. */
export const rememberInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\r\n]+$/, "One line, without line breaks.")
    .describe("One line of at most 300 characters, without line breaks."),
});

/**
 * What the tools do. A refusal, such as an id that is no KC of the Course,
 * throws a `TutorToolError`, whose message the model sees.
 */
export type TutorToolActions = {
  readKcs: (kcIds: string[]) => Promise<KcReading[]>;
  /** A note, without Exercises, tells the model why there are none. */
  findExercises: (
    kcIds: string[],
  ) => Promise<{ exercises: ExerciseView[]; note?: string }>;
  recordAttempt: (
    attempt: z.infer<typeof recordAttemptInputSchema>,
  ) => Promise<RecordedKc[]>;
  /** Appends one line to the Course's Memory. */
  remember: (text: string) => Promise<void>;
};

/** A refused tool call: its message tells the model what to fix. */
export class TutorToolError extends Error {
  override name = "TutorToolError";
}

/** The tools the AI tutors with in a Chat. */
export function tutorTools(actions: TutorToolActions) {
  return {
    readKcs: tool({
      description:
        "Read KCs of this Course before teaching them: each KC's name, type and description, and up to 3 source chunks from the Course's Materials in reading order, each with its Markdown, Material, pages and a link to cite.",
      inputSchema: readKcsInputSchema,
      execute: async ({ kcIds }) => ({ kcs: await actions.readKcs(kcIds) }),
    }),
    findExercises: tool({
      description:
        "Find up to 3 Exercises of this Course that test any of the given KCs and that the Student has not attempted yet, old-exam ones first. Each comes with its question, the KCs it tests, a link to cite and its solution, labelled with its status. Use it for the apply step; never show the solution before the Student has tried. A disputed solution may be wrong: check it yourself before relying on it.",
      inputSchema: findExercisesInputSchema,
      execute: async ({ kcIds }) => actions.findExercises(kcIds),
    }),
    recordAttempt: tool({
      description:
        "Record the Student's evidence when a problem or review question ends: which KCs it tested, whether the Student got each right, and how much you helped. Returns each KC's new level (1 to 5) and next review date (YYYY-MM-DD).",
      inputSchema: recordAttemptInputSchema,
      execute: async (attempt) => ({
        kcs: await actions.recordAttempt(attempt),
      }),
    }),
    remember: tool({
      description:
        "Save one line to your Memory of this Student in this Course, which you read in every later Chat: something that will help you tutor them, such as a preference, how they like to learn or their context. The date is added for you.",
      inputSchema: rememberInputSchema,
      execute: async ({ text }) => {
        await actions.remember(text);
        return { ok: true };
      },
    }),
  };
}

export type TutorTools = ReturnType<typeof tutorTools>;
