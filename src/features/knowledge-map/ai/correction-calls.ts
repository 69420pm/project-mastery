import { Output } from "ai";
import { z } from "zod";
import { SEMANTIC_LINK_TYPES } from "@/features/knowledge-map/schemas";
import { aiTask } from "@/lib/ai/models";

/**
 * The corrections call of an Update map (task `map`, #181): one call over
 * the map Findings the Student accepted, each with its KCs and the quoted
 * chunk. Ids are local to the call. KC ids in the answer are plain strings,
 * so a change naming another KC is dropped by code instead of failing the
 * call.
 */

const pair = z.object({
  from: z.string().describe("A KC id."),
  to: z.string().describe("A KC id."),
});

const findingAnswer = z.object({
  outcome: z
    .string()
    .trim()
    .min(1)
    .describe(
      'One line for the Student on what changed and why, such as "Removed the prerequisite: the lecture derives thrust without drag." or "No change: the sources support the map."',
    ),
  addPrerequisites: z
    .array(pair)
    .describe("New prerequisites: `from` must be learned before `to`."),
  removePrerequisites: z
    .array(pair)
    .describe("Prerequisites of the map to remove, as they are listed."),
  addSemanticLinks: z
    .array(
      pair.extend({
        coreType: z.enum(SEMANTIC_LINK_TYPES),
        label: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('The relation in a few words, such as "occurs in".'),
      }),
    )
    .describe("New relations that order no learning."),
  removeSemanticLinks: z
    .array(pair)
    .describe("Semantic links of the map to remove, as they are listed."),
  descriptions: z
    .array(
      z.object({
        kcId: z.string(),
        description: z.string().trim().min(1).max(1000),
      }),
    )
    .describe("A new one-line description of the Finding's KC, if wrong."),
});

/** What the corrections call answers for Findings with these ids. */
export function correctionsSchema(findingIds: string[]) {
  return z.object({
    findings: z
      .object(Object.fromEntries(findingIds.map((id) => [id, findingAnswer])))
      .describe("Every Finding, by id."),
  });
}

export type CorrectionsOutput = z.infer<ReturnType<typeof correctionsSchema>>;

const CORRECTIONS_INSTRUCTIONS = `You correct the knowledge map of a university course. A Student and their tutor found places where the map disagrees with the course's materials, and the Student accepted each. You get these Findings as JSON: each has its kind (missing_link, wrong_link or wrong_description), its KC and, for a link kind, the linked KC, which is the prerequisite or semantic neighbour of the first; each KC has an id, name and description; the links between the two KCs the map has now; the reason; and a quote from a chunk of the materials, with the chunk's Markdown. Trust the materials over the map, and the map over the Finding when the chunk does not support it. For each Finding, give only the changes the chunk supports: add or remove a prerequisite or a semantic link between its two KCs, or give its KC a new description. Change nothing else. Give every Finding a one-line outcome, also when you change nothing.`;

/** The corrections call over the accepted Findings, by local ids. */
export function correctionsCall(
  findings: Array<{
    id: string;
    kind: string;
    kc: { id: string; name: string; description: string };
    linkedKc: { id: string; name: string; description: string } | null;
    links: Array<
      | { type: "prerequisite"; from: string; to: string }
      | {
          type: "semantic";
          from: string;
          to: string;
          coreType: string;
          label: string;
        }
    >;
    reason: string;
    quote: string;
    chunk: string;
  }>,
) {
  return {
    ...aiTask("map"),
    // With reasoning on, MiMo can answer a structured output with an empty
    // text (docs/agents/notes/ai-sdk.md).
    reasoning: "none" as const,
    instructions: CORRECTIONS_INSTRUCTIONS,
    output: Output.object({
      schema: correctionsSchema(findings.map((finding) => finding.id)),
    }),
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: JSON.stringify({ findings }) },
        ],
      },
    ],
  };
}
