import {
  MockEmbeddingModelV4,
  MockLanguageModelV4,
  MockProviderV4,
  simulateReadableStream,
} from "ai/test";
import { onTestFinished, vi } from "vitest";
import { AI_TASKS, type AiTask } from "./models";

/**
 * Test helpers for AI code. Unit tests and CI never call real models
 * (ADR 0006): `useMockModels` routes every task to a mock.
 * Test files that import server-only modules add `vi.mock("server-only", () => ({}))`.
 */

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

/** A language model that answers every call with `text`, streamed word by word. */
export function mockTextModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "text-1" },
          ...text.split(/(?<= )/).map((delta) => ({
            type: "text-delta" as const,
            id: "text-1",
            delta,
          })),
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          },
        ],
      }),
    }),
  });
}

/** A tool call a mock model makes. */
export type MockToolCall = { toolName: string; input: unknown };

/**
 * A language model that streams one step of tool calls per entry of `steps`,
 * one entry per call, and answers with `text` once they are used up. So with
 * a step limit, a `streamText` call runs each step's tools, then gets `text`.
 */
export function mockToolModel(steps: MockToolCall[][], text: string) {
  const answer = mockTextModel(text);
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const calls = steps[call++];
      if (!calls) return answer.doStream(options);
      return {
        stream: simulateReadableStream({
          chunks: [
            ...calls.map(({ toolName, input }, i) => ({
              type: "tool-call" as const,
              toolCallId: `call-${call}-${i}`,
              toolName,
              input: JSON.stringify(input),
            })),
            {
              type: "finish" as const,
              finishReason: { unified: "tool-calls" as const, raw: undefined },
              usage,
            },
          ],
        }),
      };
    },
  });
}

/**
 * An embedding model that returns a fixed vector of `dimensions` per value
 * and, like some providers, reports no usage.
 */
export function mockEmbeddingModel(dimensions = 3) {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() =>
        Array.from({ length: dimensions }, () => 0.5),
      ),
      usage: undefined,
      warnings: [],
    }),
  });
}

/**
 * A model for `modelId` that hands each call to the mock of the task named
 * in its gateway tags (`task:<name>`), and fails for a task without one.
 */
function routedByTask(
  modelId: string,
  byTask: Map<string, MockLanguageModelV4>,
) {
  const modelFor = (options: {
    providerOptions?: { gateway?: { tags?: string[] } };
  }) => {
    const task = options.providerOptions?.gateway?.tags
      ?.find((tag) => tag.startsWith("task:"))
      ?.slice("task:".length);
    const model =
      task === undefined ? byTask.values().next().value : byTask.get(task);
    if (!model) {
      throw new Error(`No mock model for task "${task}" (${modelId}).`);
    }
    return model;
  };
  return new MockLanguageModelV4({
    modelId,
    doGenerate: (options) => modelFor(options).doGenerate(options),
    doStream: (options) => modelFor(options).doStream(options),
  });
}

type MockModels = {
  [Task in AiTask]?: Task extends "embed"
    ? MockEmbeddingModelV4
    : MockLanguageModelV4;
};

/**
 * Routes the given tasks to mock models for the current test. Model ids
 * resolve through the AI SDK's global provider, which this replaces, so any
 * task without a mock fails instead of reaching AI Gateway. Tasks may share a model id: a call
 * reaches the mock of its task, which `aiTask` names in the call's gateway
 * tags.
 */
export function useMockModels(models: MockModels) {
  vi.stubEnv("AI_PROVIDER", "gateway");
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  for (const config of Object.values(AI_TASKS)) {
    vi.stubEnv(config.override, undefined);
  }

  const languageByModelId: Record<
    string,
    Map<string, MockLanguageModelV4>
  > = {};
  const embeddingModels: Record<string, MockEmbeddingModelV4> = {};
  for (const [task, model] of Object.entries(models)) {
    const id = AI_TASKS[task as AiTask].model;
    if (model instanceof MockEmbeddingModelV4) embeddingModels[id] = model;
    else (languageByModelId[id] ??= new Map()).set(task, model);
  }
  const languageModels = Object.fromEntries(
    Object.entries(languageByModelId).map(([id, byTask]) => [
      id,
      routedByTask(id, byTask),
    ]),
  );

  const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV4({
    languageModels,
    embeddingModels,
  });
  onTestFinished(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
    vi.unstubAllEnvs();
  });
}
