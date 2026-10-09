import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Evaluator, ExperimentTask } from "@langfuse/client";
import { APICallError, RetryError } from "ai";
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

/**
 * Thrown for every model call after the provider answered `429`. The free
 * tier's quota is per model and per day, so retrying, or switching to another
 * model, only spends the quota that is left.
 */
export class QuotaExhaustedError extends Error {
  constructor() {
    super(
      "The model provider answered 429 (quota exhausted). The eval stopped: run it again when the quota resets, not with another model.",
    );
  }
}

function isQuotaError(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isQuotaError(error.lastError);
  return APICallError.isInstance(error) && error.statusCode === 429;
}

let quotaExhausted = false;

export function isQuotaExhausted() {
  return quotaExhausted;
}

/**
 * Wraps a definition so that its task and evaluators stop making model calls
 * after the first `429`. The Langfuse runner catches failures per item, so the
 * caller checks `isQuotaExhausted()` after a run as well.
 */
export function withQuotaGuard<Input, Expected>(
  definition: EvalDefinition<Input, Expected>,
): EvalDefinition<Input, Expected> {
  const guard =
    <Args extends unknown[], Result>(
      call: (...args: Args) => Promise<Result>,
    ) =>
    async (...args: Args) => {
      if (quotaExhausted) throw new QuotaExhaustedError();
      try {
        return await call(...args);
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        quotaExhausted = true;
        throw new QuotaExhaustedError();
      }
    };
  return {
    ...definition,
    task: guard(definition.task),
    evaluators: definition.evaluators.map(guard),
  };
}
