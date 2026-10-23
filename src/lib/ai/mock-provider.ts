import "server-only";
import { simulateReadableStream, type JSONSchema7 } from "ai";

/**
 * Deterministic models for AI_PROVIDER=mock, so end-to-end tests run the real
 * app without model calls (ADR 0006). Every model id answers, whatever the
 * task: a language model replies to the last user message, streamed word by
 * word slowly enough that a test can stop it mid-reply. Unlike the helpers in
 * `testing.ts`, this runs in the production build and does not use Vitest.
 */

/** Delay between streamed words, a reply takes a few seconds in total. */
const WORD_DELAY_MS = 75;

// The size of chunks.embedding, so the mock's vectors fit the column.
const EMBEDDING_DIMENSIONS = 2048;

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

const MOCK_REPLY_START = 'Mock reply to "';

/** Whether a stored reply's text came from the mock models. */
export function isMockReply(text: string): boolean {
  return text.startsWith(MOCK_REPLY_START);
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
  return `${MOCK_REPLY_START}${text}".${attached} This is a deterministic answer from the mock AI. It streams word by word, slowly enough for an end-to-end test to stop it before it ends, and it never calls a real model.`;
}

/** The text of every string in a mock object: inline math, so it renders. */
const MOCK_OBJECT_TEXT =
  "Mock text from the mock AI, with a formula: $a^2 + b^2 = c^2$.";

type SchemaDefinition = JSONSchema7 | boolean;

/**
 * A deterministic value that fits a JSON schema, for structured output
 * (`Output.object`): required properties only, one item per array (every
 * value for an array of enum values), the first enum value, null where null
 * is allowed, and strings with a formula.
 */
function mockObject(definition: SchemaDefinition | undefined): unknown {
  const schema = typeof definition === "object" ? definition : {};
  const options = schema.anyOf ?? schema.oneOf;
  if (options) {
    const isNull = (option: SchemaDefinition) =>
      typeof option === "object" && option.type === "null";
    return options.some(isNull) ? null : mockObject(options[0]);
  }
  if (schema.enum) return schema.enum[0];
  const types = [schema.type ?? "object"].flat();
  if (types.includes("null")) return null;
  switch (types[0]) {
    case "object":
      return Object.fromEntries(
        (schema.required ?? []).map((key) => [
          key,
          mockObject(schema.properties?.[key]),
        ]),
      );
    case "array": {
      const items = [schema.items].flat()[0];
      // Every value of an enum, such as ids a prompt offers, so a caller that
      // must see each id once gets a valid answer.
      if (typeof items === "object" && items.enum) return [...items.enum];
      return [mockObject(items)];
    }
    case "string":
      return MOCK_OBJECT_TEXT;
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return false;
    default:
      return null;
  }
}

type ResponseFormat =
  { type: "text" } | { type: "json"; schema?: JSONSchema7 } | undefined;

/** The text a mock call answers: JSON for structured output, else a reply. */
function mockText(prompt: Prompt, responseFormat: ResponseFormat): string {
  if (responseFormat?.type === "json") {
    return JSON.stringify(mockObject(responseFormat.schema));
  }
  return mockReply(prompt);
}

/**
 * In a Brief that is asking a Finding, the mock takes the Student's message
 * as its answer: when the instructions name the question being asked, it
 * first calls `answerFinding` with the message, then replies.
 */
function mockAnswerFinding(
  prompt: Prompt,
  tools: ReadonlyArray<{ name: string }> | undefined,
) {
  if (!tools?.some(({ name }) => name === "answerFinding")) return null;
  if (prompt.at(-1)?.role !== "user") return null;
  const system = prompt.find(({ role }) => role === "system")?.content;
  const findingId =
    typeof system === "string"
      ? /asking now \(id ([0-9a-f-]{36})\)/.exec(system)?.[1]
      : undefined;
  if (!findingId) return null;
  const answer = lastUserParts(prompt)
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ");
  return simulateReadableStream({
    initialDelayInMs: null,
    chunkDelayInMs: null,
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      {
        type: "tool-call" as const,
        toolCallId: "mock-answer-finding",
        toolName: "answerFinding",
        input: JSON.stringify({ findingId, answer }),
      },
      {
        type: "finish" as const,
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
      },
    ],
  });
}

function languageModel(modelId: string) {
  return {
    specificationVersion: "v4" as const,
    provider: "mock",
    modelId,
    supportedUrls: {},
    doGenerate: async ({
      prompt,
      responseFormat,
    }: {
      prompt: Prompt;
      responseFormat?: ResponseFormat;
    }) => ({
      content: [
        { type: "text" as const, text: mockText(prompt, responseFormat) },
      ],
      finishReason,
      usage,
      warnings: [],
    }),
    doStream: async ({
      prompt,
      tools,
    }: {
      prompt: Prompt;
      tools?: ReadonlyArray<{ name: string }>;
    }) => ({
      stream:
        mockAnswerFinding(prompt, tools) ??
        simulateReadableStream({
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
      // Like some providers, which report no usage for embeddings.
      usage: undefined,
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
