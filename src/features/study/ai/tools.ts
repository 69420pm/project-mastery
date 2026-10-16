import { tool } from "ai";
import { z } from "zod";
import type { ExerciseView, KcReading } from "@/features/study/types";

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

/**
 * What the tools do. A refusal, such as an id that is no KC of the Course,
 * throws a `TutorToolError`, whose message the model sees.
 */
export type TutorToolActions = {
  readKcs: (kcIds: string[]) => Promise<KcReading[]>;
  findExercises: (kcIds: string[]) => Promise<ExerciseView[]>;
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
        "Find up to 3 Exercises of this Course that test any of the given KCs, old-exam ones first. Each comes with its question, the KCs it tests, a link to cite and its solution, labelled with its status. Use it for the apply step; never show the solution before the Student has tried. A disputed solution may be wrong: check it yourself before relying on it.",
      inputSchema: findExercisesInputSchema,
      execute: async ({ kcIds }) => ({
        exercises: await actions.findExercises(kcIds),
      }),
    }),
  };
}

export type TutorTools = ReturnType<typeof tutorTools>;
