import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/** A Topic the naming call is offered. */
export type OfferedTopic = {
  /** Short and only for the call, such as t1. */
  id: string;
  /** Its Parts' titles, in Course order. */
  parts: string[];
  /** Its KCs' names, in teaching order. */
  kcs: string[];
};

/** What the naming call gets: one Big idea's new Topics. */
export type OfferedBigIdea = {
  bigIdea: string;
  /** The Course language, as a BCP 47 tag. */
  language: string;
  topics: readonly [OfferedTopic, ...OfferedTopic[]];
};

/** The most characters of a Topic name. */
export const MAX_TOPIC_NAME = 80;

/** What the naming call returns: a name and question for every Topic id. */
export function topicNamingSchema(topicIds: readonly string[]) {
  return z.object({
    topics: z.object(
      Object.fromEntries(
        topicIds.map((id) => [
          id,
          z.object({
            name: z
              .string()
              .describe(
                `Close to its Parts' titles, at most ${MAX_TOPIC_NAME} characters.`,
              ),
            centralQuestion: z
              .string()
              .describe("The one question its KCs together answer."),
          }),
        ]),
      ),
    ),
  });
}

const NAMING_INSTRUCTIONS = `You get the new Topics of one Big idea (a chapter) of a university course as JSON: each Topic with the titles of the Parts of the materials it covers and the names of its knowledge components (KCs). Give every Topic a name and a central question.

- The name stays close to its Parts' titles, without numbering, at most ${MAX_TOPIC_NAME} characters.
- The central question is the one question a student can answer once they know the Topic's KCs.
- Write in the course language. Formulas in LaTeX ($...$).`;

/**
 * Call settings for the naming call of one Big idea (task `topic`):
 *
 *   generateText({ ...topicNamingSettings(b), messages: topicNamingMessages(b) })
 */
export function topicNamingSettings(bigIdea: OfferedBigIdea) {
  return {
    ...aiTask("topic"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: NAMING_INSTRUCTIONS,
    output: Output.object({
      schema: topicNamingSchema(bigIdea.topics.map((topic) => topic.id)),
    }),
  };
}

/** The user message of a naming call: the Big idea's new Topics, as JSON. */
export function topicNamingMessages(bigIdea: OfferedBigIdea) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify(bigIdea) }],
    },
  ];
}
