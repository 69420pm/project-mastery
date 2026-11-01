import { z } from "zod";
import type { MapFindingKind } from "@/features/study/types";

const MAP_FINDING_KINDS = [
  "missing_link",
  "wrong_link",
  "wrong_description",
] as const satisfies readonly MapFindingKind[];

/** What `flagMap` takes: a map Finding with the quote that shows it. */
export const flagMapInputSchema = z.object({
  kind: z
    .enum(MAP_FINDING_KINDS)
    .describe(
      "missing_link: the sources show one KC builds on the other, and the map doesn't link them; wrong_link: the map links them and the sources contradict it; wrong_description: the sources contradict the KC's description.",
    ),
  kcId: z
    .string()
    .describe(
      "The id of the KC of this Course the Finding is about: for a link, the one that builds on the other.",
    ),
  linkedKcId: z
    .string()
    .nullish()
    .describe(
      "For a link kind, the id of kcId's prerequisite: the KC that kcId builds on; omit it for wrong_description.",
    ),
  proposedDescription: z
    .string()
    .min(1)
    .max(1000)
    .nullish()
    .describe(
      "For wrong_description, the KC's new description, which replaces the old one when the Student accepts: at most 1,000 characters, in the style of the existing descriptions. Omit it for a link kind.",
    ),
  chunkId: z
    .string()
    .describe(
      "The chunkId of the source chunk that shows it, from getTopic or searchMaterials.",
    ),
  quote: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "The words of that chunk's Markdown that show it, copied exactly: at most 500 characters.",
    ),
  reason: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^\r\n]+$/, "One line, without line breaks.")
    .describe(
      "What is wrong with the map and what the sources say, in one line of at most 300 characters.",
    ),
});

export type FlagMapInput = z.infer<typeof flagMapInputSchema>;
