import { tool } from "ai";
import { z } from "zod";
import type {
  ProgramRun,
  ProgramValue,
} from "@/features/study/server/math-runner";

/** What `compute` takes: a mathjs program. */
const computeInputSchema = z.object({
  program: z
    .string()
    .min(1)
    .describe(
      "A mathjs program of at most 4,000 characters: one assignment per line, units inline, such as `mass_flow = 40 kg/s`, `thrust = mass_flow * (600 m/s - 250 m/s)`, `thrust_kN = to(thrust, kN)`. Never name a variable like a unit (m, s, g, N, K, T, ...): use mass, time or mass_flow.",
    ),
});

/** What `compute` returns: the values, or the error as data. */
type ComputeOutput =
  { values: Record<string, ProgramValue> } | { error: string };

/** The `compute` tool, running programs through `run`. */
export function computeTool(run: (program: string) => Promise<ProgramRun>) {
  return tool({
    description:
      "Run a mathjs program to do arithmetic exactly instead of in your head, such as redoing a Student's steps to check their numbers. Returns every assigned variable's value with its unit and as text, or the error that stopped the program: then fix the program and run it again.",
    inputSchema: computeInputSchema,
    execute: async ({ program }): Promise<ComputeOutput> => {
      const result = await run(program);
      return result.ok ? { values: result.values } : { error: result.error };
    },
  });
}
