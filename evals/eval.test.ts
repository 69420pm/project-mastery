// @vitest-environment node
import { APICallError, RetryError } from "ai";
import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { EvalDefinition } from "./eval";

// The guard latches for the whole process, so each test loads a fresh module.
let evalModule: typeof import("./eval");
beforeEach(async () => {
  vi.resetModules();
  evalModule = await import("./eval");
});

function apiError(statusCode: number) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
  });
}

function guarded(task: EvalDefinition<string, string>["task"]) {
  const evaluator = vi.fn(async () => ({ name: "score", value: 1 }));
  const definition = evalModule.withQuotaGuard<string, string>({
    name: "example",
    input: z.string(),
    expectedOutput: z.string(),
    task,
    evaluators: [evaluator],
    gates: [],
    minPassRate: 1,
  });
  return { definition, evaluator };
}

test.each([
  ["a plain 429", apiError(429)],
  [
    "a 429 in a RetryError",
    new RetryError({
      message: "retries failed",
      reason: "maxRetriesExceeded",
      errors: [apiError(500), apiError(429)],
    }),
  ],
])("%s stops every later call", async (_, error) => {
  const task = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
  const { definition, evaluator } = guarded(task);

  await expect(definition.task("a")).rejects.toThrow(
    evalModule.QuotaExhaustedError,
  );
  expect(evalModule.isQuotaExhausted()).toBe(true);
  await expect(definition.task("b")).rejects.toThrow(
    evalModule.QuotaExhaustedError,
  );
  await expect(
    definition.evaluators[0]!({ input: "a", output: "ok" }),
  ).rejects.toThrow(evalModule.QuotaExhaustedError);
  expect(task).toHaveBeenCalledTimes(1);
  expect(evaluator).not.toHaveBeenCalled();
});

test("another error passes through and does not latch", async () => {
  const error = apiError(500);
  const task = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
  const { definition } = guarded(task);

  await expect(definition.task("a")).rejects.toBe(error);
  expect(evalModule.isQuotaExhausted()).toBe(false);
  await expect(definition.task("b")).resolves.toBe("ok");
});
