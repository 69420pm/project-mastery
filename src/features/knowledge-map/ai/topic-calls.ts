import { Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/**
 * The `topic` call of a Knowledge map build (#175): one per Big idea with
 * KCs no Topic holds yet, which groups them into Topics with a central
 * question. KCs and stored Topics go to the model by short local ids; KC ids
 * come back through an enum, so the answer can only name KCs it was sent.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

/** What the call is sent for one Big idea, with local ids. */
export type TopicCallInput = {
  bigIdeaToGroup: { name: string; description: string };
  kcs: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    /** Its first source, such as "Lecture 1 p. 3"; null without one. */
    firstSource: string | null;
    /** New KCs need a Topic; placed ones have one. */
    status: "new" | "placed";
  }>;
  prerequisites: Array<{ from: string; to: string }>;
  semanticLinks: Array<{ from: string; to: string; label: string }>;
  storedTopics: Array<{
    id: string;
    name: string;
    centralQuestion: string;
    kcs: string[];
  }>;
};

/** What the call answers for a Big idea whose KCs have these local ids. */
export function topicSchema(kcIds: string[]) {
  const [first, ...rest] = kcIds;
  if (first === undefined) throw new Error("Topics need KCs.");
  return z.object({
    topics: z.array(
      z.object({
        id: text(100).describe(
          'A stored Topic\'s id, or a new id such as "new1" for a new Topic.',
        ),
        name: text(200),
        centralQuestion: text(500).describe(
          "The one question the Topic's KCs together answer.",
        ),
        whyItMatters: text(1000).describe("One line."),
        kcs: z
          .array(z.enum([first, ...rest]))
          .min(1)
          .describe("The Topic's KC ids, in the order to teach them."),
      }),
    ),
  });
}

const INSTRUCTIONS = `You group the knowledge components (KCs) of one big idea of a university course into Topics: units a Student learns in one sitting. You get the big idea, its KCs (each with an id, name, type, description, first source and whether it is new or placed), the prerequisites and semantic links among them, and the Topics stored so far with their KCs, as JSON. A Topic holds 3 to 10 KCs that answer one central question together. Give each Topic an id, a name, its central question, one line on why it matters, and its KC ids in the order to teach them, prerequisites first. Every new KC goes into exactly one Topic. When Topics are stored already, place only the new KCs: put each into a stored Topic by its id, or into a new Topic with a new id; leave the placed KCs where they are.`;

/** One `topic` call for a Big idea. */
export function topicCall(input: TopicCallInput) {
  return {
    ...aiTask("topic"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: INSTRUCTIONS,
    output: Output.object({
      schema: topicSchema(input.kcs.map((kc) => kc.id)),
    }),
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: JSON.stringify(input) }],
      },
    ],
  };
}
