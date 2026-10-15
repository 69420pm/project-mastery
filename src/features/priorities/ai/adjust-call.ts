import { Output } from "ai";
import { z } from "zod";
import {
  MAX_ADJUSTMENT,
  type AdjustmentEntry,
} from "@/features/priorities/domain/adjustment";
import { aiTask } from "@/lib/ai/models";

/**
 * The one model call of a priority run (task `priority`): it reads the
 * Brief's notes, the answered Findings, the big ideas and the KCs, and
 * answers multipliers for the big ideas and KCs the Student's statements
 * concern. Ids go to the model as short local ones (`B1`, `K1`), and the
 * output names them through an enum, so it can only name what exists.
 */

/** What the call reads, by the map's real ids. */
export type AdjustInput = {
  notes: string | null;
  findings: Array<{ text: string; answer: string }>;
  bigIdeas: Array<{ id: string; name: string; description: string }>;
  kcs: Array<{
    id: string;
    name: string;
    description: string;
    bigIdea: string | null;
  }>;
};

const INSTRUCTIONS = `You adjust how much each part of a university course matters for one Student's exam. You get what the Student told about the exam (notes), their answers to questions about the material (findings), and the course's big ideas and knowledge components (KCs), as JSON. Give an entry only for a big idea or KC the notes or answers say something about: a multiplier from 0 to ${MAX_ADJUSTMENT} and a one-line reason for the Student, such as "The lecturer stressed it". Use 0 for what is not examined, below 1 for what matters less, above 1 for what the lecturer stressed or the exam focuses on. A big idea's entry applies to all its KCs, and a KC's entry overrides it. Give no entry for anything the Student said nothing about.`;

/** The call settings and how to read its answer back into real ids. */
export function adjustCall(input: AdjustInput) {
  const local = [
    ...input.bigIdeas.map((bigIdea, i) => [`B${i + 1}`, bigIdea.id] as const),
    ...input.kcs.map((kc, i) => [`K${i + 1}`, kc.id] as const),
  ];
  const [first, ...rest] = local.map(([alias]) => alias);
  if (first === undefined) throw new Error("An adjustment needs a map.");
  const schema = z.object({
    entries: z.array(
      z.object({
        id: z.enum([first, ...rest]),
        multiplier: z.number().describe(`From 0 to ${MAX_ADJUSTMENT}.`),
        reason: z.string().trim().min(1).max(300).describe("One line."),
      }),
    ),
  });
  const realId = new Map(local);
  const bigIdeaAlias = new Map(
    input.bigIdeas.map((bigIdea, i) => [bigIdea.id, `B${i + 1}`]),
  );
  return {
    call: {
      ...aiTask("priority"),
      // With reasoning on, MiMo answered this structured output with an
      // empty text (docs/agents/notes/ai-sdk.md).
      reasoning: "none" as const,
      instructions: INSTRUCTIONS,
      output: Output.object({ schema }),
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                notes: input.notes ?? "",
                findings: input.findings,
                bigIdeas: input.bigIdeas.map((bigIdea, i) => ({
                  id: `B${i + 1}`,
                  name: bigIdea.name,
                  description: bigIdea.description,
                })),
                kcs: input.kcs.map((kc, i) => ({
                  id: `K${i + 1}`,
                  name: kc.name,
                  description: kc.description,
                  bigIdea: kc.bigIdea && bigIdeaAlias.get(kc.bigIdea),
                })),
              }),
            },
          ],
        },
      ],
    },
    /** The model's output as entries by real id. */
    entries(output: unknown): AdjustmentEntry[] {
      return schema.parse(output).entries.map((entry) => ({
        id: realId.get(entry.id) as string,
        multiplier: entry.multiplier,
        reason: entry.reason,
      }));
    },
  };
}
