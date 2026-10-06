import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Evaluator, ExperimentTask } from "@langfuse/client";
import { z } from "zod";

/**
 * One eval: a dataset (the local fixture is the source of truth and is synced
 * to a Langfuse dataset of the same name), the task under test, and scorers.
 */
export type EvalDefinition<Input, Expected> = {
  name: string;
  input: z.ZodType<Input>;
  expectedOutput: z.ZodType<Expected>;
  task: (input: Input) => Promise<string>;
  evaluators: Evaluator<Input, Expected>[];
  /** Scores an item must all pass (value 1) to count as passed. */
  gates: string[];
  /** Share of items that must pass for `pnpm evals` to exit successfully. */
  minPassRate: number;
};

export type EvalItem<Input, Expected> = {
  id: string;
  input: Input;
  expectedOutput: Expected;
};

/** Loads and validates `evals/datasets/<name>.json`. */
export async function loadFixture<Input, Expected>(
  definition: EvalDefinition<Input, Expected>,
) {
  const schema = z.object({
    description: z.string(),
    items: z.array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        input: definition.input,
        expectedOutput: definition.expectedOutput,
      }),
    ),
  });
  // `pnpm evals` runs from the repository root.
  const file = path.join("evals", "datasets", `${definition.name}.json`);
  return schema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Adapts a definition's typed task to the Langfuse experiment runner. */
export function experimentTask<Input, Expected>(
  definition: EvalDefinition<Input, Expected>,
): ExperimentTask<Input, Expected> {
  return async (item) => definition.task(definition.input.parse(item.input));
}
