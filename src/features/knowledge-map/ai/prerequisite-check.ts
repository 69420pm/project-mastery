import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { offeredId } from "@/features/knowledge-map/ai/offered-id";
import { aiTask } from "@/lib/ai/models";

/** A KC the Prerequisite check is offered. */
export type OfferedKc = {
  /** Short and only for the call, such as k1. */
  id: string;
  name: string;
  description: string;
};

/** A name a KC assumes, with the earlier KCs it may mean. */
export type OfferedName = {
  /** Short and only for the call, such as n1. */
  id: string;
  name: string;
  /** The KC that assumes it, as "name: description". */
  usedBy: string;
  candidates: readonly [OfferedKc, ...OfferedKc[]];
};

/**
 * What the check returns: for each name, the id of the candidate it means,
 * or null. Any string validates as an id (`offeredId`): code reads an
 * unknown one as null.
 */
export function prerequisiteCheckSchema(names: readonly OfferedName[]) {
  return z.object({
    meanings: z.object(
      Object.fromEntries(
        names.map((name) => [
          name.id,
          offeredId(name.candidates.map((kc) => kc.id)).nullable(),
        ]),
      ),
    ),
  });
}

const CHECK_INSTRUCTIONS = `You get names of things that knowledge components (KCs) of a university course assume, as JSON: each name with the KC that uses it and up to 5 candidate KCs taught earlier in the course. For each name, say which candidate it means.

- Pick a candidate only when the name means the same thing as that KC, so a student must know the KC to understand the one that uses it.
- Answer null when no candidate is meant, or when you are not sure. Do not guess.`;

/**
 * Call settings for one Prerequisite check of a build (task `map`), over up
 * to 25 names:
 *
 *   generateText({ ...prerequisiteCheckSettings(n), messages: prerequisiteCheckMessages(n) })
 */
export function prerequisiteCheckSettings(names: readonly OfferedName[]) {
  return {
    ...aiTask("map"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: CHECK_INSTRUCTIONS,
    output: Output.object({ schema: prerequisiteCheckSchema(names) }),
  };
}

/** The user message of a Prerequisite check: the names, as JSON. */
export function prerequisiteCheckMessages(names: readonly OfferedName[]) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify({ names }) }],
    },
  ];
}
