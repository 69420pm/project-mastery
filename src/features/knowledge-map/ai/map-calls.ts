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
  SEMANTIC_LINK_TYPES,
} from "@/features/knowledge-map/schemas";
import { aiTask } from "@/lib/ai/models";

/**
 * The model calls of a Knowledge map update (task `map`): the skeleton, one
 * assignment per batch of new chunks, one fill per big idea with new KCs,
 * and the links of the new KCs over all KCs. Each prompt
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

const SKELETON_INSTRUCTIONS = `You outline the knowledge map of a university course. You get the names of its materials, their markdown headings and every definition, as JSON. Give the course's big ideas: the few broad themes everything in it serves, usually 3 to 6 for a chapter and never more than ${MAX_BIG_IDEAS}. Give each a name and a one-line description, and list the candidate KCs it holds, each with a name and a one-line description. A section heading usually holds several KCs: the facts, concepts, formulas, procedures and decisions a Student must master in it, each small enough for one short question, so a big idea usually holds 5 to 12 of them. List them all; later steps check every candidate against the material and drop the ones no chunk teaches. When the map already has big ideas (existingBigIdeas, with their KCs), the materials are new ones added to the course: those big ideas and KCs stay as they are. Give only what the new materials add: new big ideas, and new candidate KCs; to put a candidate under an existing big idea, give that big idea by its exact name with only the new KCs. Never repeat an existing KC.`;

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
  const [firstBigIdea, ...restBigIdeas] = bigIdeaIds;
  if (chunkIds.length === 0 || firstBigIdea === undefined) {
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
                "The ids of the listed KCs this chunk teaches.",
              ),
              newKcs: z
                .array(
                  z.object({
                    name,
                    description: description.describe("One line."),
                    bigIdea: z.enum([firstBigIdea, ...restBigIdeas]),
                  }),
                )
                .describe(
                  "Every other KC this chunk teaches, which the list lacks, at the one-short-question grain.",
                ),
            }),
          ]),
        ),
      )
      .describe("Every chunk of the batch, by id."),
  });
}

const ASSIGNMENT_INSTRUCTIONS = `You map the chunks of a university course to the knowledge components (KCs) they teach. You get the course's big ideas, its KCs so far and a batch of chunks in reading order, as JSON. Go through the chunks one by one. For each, list what it teaches: every fact, definition, formula, procedure or decision a Student must master from it. A content or definition chunk that explains something teaches at least one KC, and a paragraph usually teaches two to four. A chunk that only titles, summarises or points elsewhere (a heading, a key-points list, an exercise list, references) teaches the listed KCs it repeats, or none; a section, summary or exercise set is never a KC itself. Give the ids of the listed KCs among them, and propose each one the list lacks as a new KC of that chunk, with its big idea; do not file it under a broader KC instead. A KC proposed for an earlier chunk of the batch is listed again by the same name under a later chunk that teaches it too.`;

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

const confidence = z
  .number()
  .min(0)
  .max(1)
  .describe("How sure you are, from 0 to 1.");

/** What the links call answers over KCs with these ids. */
export function linksSchema(kcIds: string[]) {
  const [first, ...rest] = kcIds;
  if (first === undefined) throw new Error("Links need KCs.");
  const kcId = z.enum([first, ...rest]);
  return z.object({
    prerequisites: z
      .array(
        z.object({
          from: kcId.describe("The KC to learn first."),
          to: kcId.describe("The KC that needs it."),
          extractionConfidence: confidence,
        }),
      )
      .describe("Direct prerequisites only, not ones implied by a chain."),
    semanticLinks: z
      .array(
        z.object({
          from: kcId,
          to: kcId,
          coreType: z.enum(SEMANTIC_LINK_TYPES),
          label: name.describe(
            'The relation in a few words, such as "occurs in".',
          ),
        }),
      )
      .describe("Relations between KCs that order no learning."),
    priorKcs: z
      .array(
        z.object({
          name,
          description: description.describe("One line."),
          requiredBy: z
            .array(kcId)
            .min(1)
            .describe("The KCs that build on it."),
          extractionConfidence: confidence,
        }),
      )
      .describe(
        "Knowledge the material assumes but does not teach, such as earlier courses' content.",
      ),
  });
}

const LINKS_INSTRUCTIONS = `You link the knowledge components (KCs) of a university course. You get every KC with its id, name and description, as JSON. Give the prerequisites: KC A is a prerequisite of KC B when a Student must know A to learn B; give only direct ones, each with how sure you are. Give the semantic links: relations between KCs that order no learning (is_a, part_of, contrasts_with, causes, special_case_of, applies_in, or other), each with a short label. Give the prior knowledge the material assumes but does not teach, as KCs of the same size, each with the KCs that build on it.`;

/** One links call over every KC of the map. */
export function linksCall(
  kcs: Array<{ id: string; name: string; description: string }>,
) {
  return {
    ...callSettings(LINKS_INSTRUCTIONS, linksSchema(kcs.map((kc) => kc.id))),
    messages: userMessage({
      kcs: kcs.map(({ id, name: kcName, description: kcDescription }) => ({
        id,
        name: kcName,
        description: kcDescription,
      })),
    }),
  };
}

const ADDED_KC_LINKS_INSTRUCTIONS = `${LINKS_INSTRUCTIONS} The KCs listed in newKcIds were just added; the others are linked already. Give only links that involve at least one new KC, and only prior knowledge that a new KC builds on.`;

/**
 * One links call over every KC of the map for the KCs added since the
 * first one (`addedKcIds`), which answers links for those only.
 */
export function addedKcLinksCall(
  kcs: Array<{ id: string; name: string; description: string }>,
  addedKcIds: string[],
) {
  return {
    ...callSettings(
      ADDED_KC_LINKS_INSTRUCTIONS,
      linksSchema(kcs.map((kc) => kc.id)),
    ),
    messages: userMessage({
      kcs: kcs.map(({ id, name: kcName, description: kcDescription }) => ({
        id,
        name: kcName,
        description: kcDescription,
      })),
      newKcIds: addedKcIds,
    }),
  };
}

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
