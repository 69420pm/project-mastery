import { tool } from "ai";
import { z } from "zod";
import type { KcReading } from "@/features/study/types";

/** What `readKcs` takes: KC ids of the Course. */
export const readKcsInputSchema = z.object({
  kcIds: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("The ids of 1 to 8 KCs of this Course."),
});

/**
 * What the tools do. A refusal, such as an id that is no KC of the Course,
 * throws a `TutorToolError`, whose message the model sees.
 */
export type TutorToolActions = {
  readKcs: (kcIds: string[]) => Promise<KcReading[]>;
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
  };
}

export type TutorTools = ReturnType<typeof tutorTools>;
