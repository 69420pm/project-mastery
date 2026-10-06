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
 * (ARCHITECTURE decision 6): `useMockModels` routes every task to a mock.
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

/** An embedding model that returns a fixed vector of `dimensions` per value. */
export function mockEmbeddingModel(dimensions = 3) {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() =>
        Array.from({ length: dimensions }, () => 0.5),
      ),
      usage: { tokens: values.length },
      warnings: [],
    }),
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
 * task without a mock fails instead of reaching AI Gateway. Tasks that share
 * a model id share its mock.
 */
export function useMockModels(models: MockModels) {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  for (const config of Object.values(AI_TASKS)) {
    vi.stubEnv(config.override, undefined);
  }

  const languageModels: Record<string, MockLanguageModelV4> = {};
  const embeddingModels: Record<string, MockEmbeddingModelV4> = {};
  for (const [task, model] of Object.entries(models)) {
    const id = AI_TASKS[task as AiTask].model;
    if (model instanceof MockEmbeddingModelV4) embeddingModels[id] = model;
    else languageModels[id] = model;
  }

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
