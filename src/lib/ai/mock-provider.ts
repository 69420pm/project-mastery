import "server-only";
import { simulateReadableStream } from "ai";

/**
 * Deterministic models for AI_PROVIDER=mock, so end-to-end tests run the real
 * app without model calls (ADR 0006). Every model id answers, whatever the
 * task: a language model replies to the last user message, streamed word by
 * word slowly enough that a test can stop it mid-reply. Unlike the helpers in
 * `testing.ts`, this runs in the production build and does not use Vitest.
 */

/** Delay between streamed words, a reply takes a few seconds in total. */
const WORD_DELAY_MS = 75;

const EMBEDDING_DIMENSIONS = 8;

/** Usage the mock reports, so cost recording sees real numbers. */
const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const finishReason = { unified: "stop" as const, raw: undefined };

type Prompt = ReadonlyArray<{ role: string; content: unknown }>;

type Part = {
  type: string;
  text?: string;
  filename?: string;
  mediaType?: string;
};

function lastUserParts(prompt: Prompt): Part[] {
  const message = prompt.findLast((m) => m.role === "user");
  if (!message) return [];
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return Array.isArray(message.content) ? (message.content as Part[]) : [];
}

/**
 * The reply to a prompt: names the question and the files sent with it, so
 * tests can tell replies apart and see what reached the AI.
 */
export function mockReply(prompt: Prompt): string {
  const parts = lastUserParts(prompt);
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ");
  const files = parts
    .filter((part) => part.type === "file")
    .map((part) => `${part.filename ?? "file"} (${part.mediaType})`);
  const attached = files.length > 0 ? ` Attached: ${files.join(", ")}.` : "";
  return `Mock reply to "${text}".${attached} This is a deterministic answer from the mock AI. It streams word by word, slowly enough for an end-to-end test to stop it before it ends, and it never calls a real model.`;
}

function languageModel(modelId: string) {
  return {
    specificationVersion: "v4" as const,
    provider: "mock",
    modelId,
    supportedUrls: {},
    doGenerate: async ({ prompt }: { prompt: Prompt }) => ({
      content: [{ type: "text" as const, text: mockReply(prompt) }],
      finishReason,
      usage,
      warnings: [],
    }),
    doStream: async ({ prompt }: { prompt: Prompt }) => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: WORD_DELAY_MS,
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "text-1" },
          ...mockReply(prompt)
            .split(/(?<= )/)
            .map((delta) => ({
              type: "text-delta" as const,
              id: "text-1",
              delta,
            })),
          { type: "text-end" as const, id: "text-1" },
          { type: "finish" as const, finishReason, usage },
        ],
      }),
    }),
  };
}

function embeddingModel(modelId: string) {
  return {
    specificationVersion: "v4" as const,
    provider: "mock",
    modelId,
    maxEmbeddingsPerCall: undefined,
    supportsParallelCalls: true,
    doEmbed: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() =>
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5),
      ),
      usage: { tokens: values.length },
      warnings: [],
    }),
  };
}

function unsupported(kind: string) {
  return (modelId: string): never => {
    throw new Error(`AI_PROVIDER=mock has no ${kind} model ("${modelId}").`);
  };
}

/** Routes every model id to the mock models, once per process. */
export function routeToMockModels() {
  globalThis.AI_SDK_DEFAULT_PROVIDER ??= {
    specificationVersion: "v4",
    languageModel,
    embeddingModel,
    imageModel: unsupported("image"),
  };
}
