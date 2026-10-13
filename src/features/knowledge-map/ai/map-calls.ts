import { Output } from "ai";
import { z } from "zod";
import type { SkeletonInput } from "@/features/knowledge-map/domain/build-input";
import type {
  DraftBigIdea,
  DraftKc,
} from "@/features/knowledge-map/domain/draft";
import {
  BLOOM_LEVELS,
  KC_TYPES,
  MAX_BIG_IDEAS,
} from "@/features/knowledge-map/schemas";
import { aiTask } from "@/lib/ai/models";

/**
 * The model calls of a Knowledge map build (task `map`): the skeleton, one
 * assignment per batch of chunks, and one fill per big idea. Each prompt
 * carries the granularity rule of #51. Ids in prompts are short and local to
 * the call or the build; outputs name them through enums, so a call can only
 * name what exists.
 */

const GRANULARITY_RULE = `A knowledge component (KC) is right-sized when one short question can test it and nothing else. Too broad: "Brayton cycle". Right: "Process 1→2 is isentropic compression in the compressor".`;

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(1000);

/** Call settings for one call with these instructions and output schema. */
function callSettings<Schema extends z.ZodType>(
  instructions: string,
  schema: Schema,
) {
  return {
    ...aiTask("map"),
    instructions: `${instructions}\n\n${GRANULARITY_RULE}`,
    output: Output.object({ schema }),
  };
}

const userMessage = (input: unknown) => [
  {
    role: "user" as const,
    content: [{ type: "text" as const, text: JSON.stringify(input) }],
  },
];

/** An array of enum values, or an always-empty array when there are none. */
function idList(ids: string[]) {
  const [first, ...rest] = ids;
  return first === undefined
    ? z.array(z.string()).max(0)
    : z.array(z.enum([first, ...rest]));
}

export const skeletonSchema = z.object({
  bigIdeas: z
    .array(
      z.object({
        name,
        description: description.describe("One line."),
        kcs: z
          .array(
            z.object({ name, description: description.describe("One line.") }),
          )
          .describe("Candidate KCs of this big idea."),
      }),
    )
    .describe(`At most ${MAX_BIG_IDEAS} big ideas.`),
});

const SKELETON_INSTRUCTIONS = `You outline the knowledge map of a university course. You get the names of its materials, their markdown headings and every definition, as JSON. Give the course's big ideas, at most ${MAX_BIG_IDEAS}: the few themes everything in it serves. Give each a name and a one-line description, and list the candidate KCs it holds, each with a name and a one-line description. Later steps check every candidate against the material, so name what the headings and definitions show, not more.`;

export function skeletonCall(input: SkeletonInput) {
  return {
    ...callSettings(SKELETON_INSTRUCTIONS, skeletonSchema),
    messages: userMessage(input),
  };
}

/** What the assignment call answers for a batch with these ids. */
export function assignmentSchema(
  chunkIds: string[],
  kcIds: string[],
  bigIdeaIds: string[],
) {
  const [firstChunk, ...restChunks] = chunkIds;
  const [firstBigIdea, ...restBigIdeas] = bigIdeaIds;
  if (firstChunk === undefined || firstBigIdea === undefined) {
    throw new Error("An assignment needs chunks and big ideas.");
  }
  return z.object({
    chunks: z
      .object(
        Object.fromEntries(
          chunkIds.map((id) => [
            id,
            z.object({
              kcIds: idList(kcIds).describe(
                "The ids of the KCs this chunk teaches; none if it teaches none.",
              ),
            }),
          ]),
        ),
      )
      .describe("Every chunk of the batch, by id."),
    newKcs: z
      .array(
        z.object({
          name,
          description: description.describe("One line."),
          bigIdea: z.enum([firstBigIdea, ...restBigIdeas]),
          chunkIds: z
            .array(z.enum([firstChunk, ...restChunks]))
            .min(1)
            .describe("The chunks of this batch that teach it."),
        }),
      )
      .describe("KCs the chunks teach that the list lacks."),
  });
}

const ASSIGNMENT_INSTRUCTIONS = `You map the chunks of a university course to the knowledge components (KCs) they teach. You get the course's big ideas, its KCs so far and a batch of chunks in reading order, as JSON. For every chunk, give the ids of the KCs it teaches. Propose a new KC only for something a chunk teaches that no KC in the list covers, with the big idea it belongs to and the chunks that teach it.`;

/** One assignment call over a batch of chunks, by local chunk ids. */
export function assignmentCall(
  bigIdeas: DraftBigIdea[],
  kcs: DraftKc[],
  chunks: Array<{ id: string; label: string; markdown: string }>,
) {
  const schema = assignmentSchema(
    chunks.map((chunk) => chunk.id),
    kcs.map((kc) => kc.id),
    bigIdeas.map((bigIdea) => bigIdea.id),
  );
  return {
    ...callSettings(ASSIGNMENT_INSTRUCTIONS, schema),
    messages: userMessage({
      bigIdeas: bigIdeas.map(({ id, name: bigIdeaName }) => ({
        id,
        name: bigIdeaName,
      })),
      kcs: kcs.map((kc) => ({
        id: kc.id,
        name: kc.name,
        description: kc.description,
        bigIdea: kc.bigIdea,
      })),
      chunks,
    }),
  };
}

/** What the fill call answers for KCs with these ids. */
export function fillSchema(kcIds: string[]) {
  return z.object({
    kcs: z
      .object(
        Object.fromEntries(
          kcIds.map((id) => [
            id,
            z.object({
              type: z.enum(KC_TYPES).exclude(["prior"]),
              bloom: z.enum(BLOOM_LEVELS),
              description: description.describe(
                "A sharper one-line description.",
              ),
            }),
          ]),
        ),
      )
      .describe("Every KC, by id."),
  });
}

const FILL_INSTRUCTIONS = `You describe the knowledge components (KCs) of one big idea of a university course. You get the big idea and its KCs, each with the markdown of the chunks that teach it, as JSON. For every KC give its type (fact, concept, procedure or decision), the Bloom level a Student needs to master it (remember, understand, apply, analyze, evaluate or create), and a sharper one-line description that matches what the chunks teach.`;

/** One fill call over a big idea's KCs and the chunks that teach them. */
export function fillCall(
  bigIdea: DraftBigIdea,
  kcs: Array<DraftKc & { chunks: string[] }>,
) {
  return {
    ...callSettings(FILL_INSTRUCTIONS, fillSchema(kcs.map((kc) => kc.id))),
    messages: userMessage({
      bigIdea: { name: bigIdea.name, description: bigIdea.description },
      kcs: kcs.map((kc) => ({
        id: kc.id,
        name: kc.name,
        description: kc.description,
        chunks: kc.chunks,
      })),
    }),
  };
}
