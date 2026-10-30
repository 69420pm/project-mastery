import "server-only";
import { Output } from "ai";
import { z } from "zod";
import { aiTask } from "@/lib/ai/models";

/** A KC the merge call is offered. */
export type OfferedKc = {
  /** Short and only for the call, such as k1. */
  id: string;
  name: string;
  description: string;
};

/** A cluster of alike KCs the merge call is offered. */
export type OfferedCluster = { kcs: OfferedKc[] };

/** What the merge call returns for clusters with these KC ids. */
export function kcMergeSchema(kcIds: readonly [string, ...string[]]) {
  return z.object({
    same: z
      .array(
        z.object({
          kcIds: z
            .array(z.enum(kcIds))
            .describe("KCs of one cluster that are the same KC."),
        }),
      )
      .describe(
        "One entry per group of KCs that are the same. Empty when none.",
      ),
  });
}

const MERGE_INSTRUCTIONS = `You get clusters of knowledge components (KCs) from one university course, as JSON: each KC with its id, name and description. The KCs of a cluster are worded alike. In each cluster, say which KCs are the same KC.

- Two KCs are the same when they teach the same thing, so one short exam question would test both.
- A KC that is a special case, a part, an application or the converse of another is not the same KC.
- Name only KCs of one cluster together. Leave out a KC that is the same as no other. Do not guess.`;

/**
 * Call settings for one merge call of a build (task `map`), over up to 15
 * clusters:
 *
 *   generateText({ ...kcMergeSettings(c), messages: kcMergeMessages(c) })
 */
export function kcMergeSettings(clusters: readonly OfferedCluster[]) {
  const ids = clusters.flatMap((cluster) => cluster.kcs.map((kc) => kc.id));
  return {
    ...aiTask("map"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: MERGE_INSTRUCTIONS,
    output: Output.object({
      schema: kcMergeSchema(ids as [string, ...string[]]),
    }),
  };
}

/** The user message of a merge call: the clusters, as JSON. */
export function kcMergeMessages(clusters: readonly OfferedCluster[]) {
  return [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: JSON.stringify({ clusters }) }],
    },
  ];
}
