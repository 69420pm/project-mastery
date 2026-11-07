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

/**
 * The block a Chat's handler puts in front of the newest Student message:
 * the tutor context, which the mock reads ids from but never echoes.
 */
const CONTEXT_START = "<tutor-context>";

const isContext = (part: Part) =>
  part.type === "text" && (part.text ?? "").startsWith(CONTEXT_START);

function lastUserContent(prompt: Prompt): Part[] {
  const message = prompt.findLast((m) => m.role === "user");
  if (!message) return [];
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return Array.isArray(message.content) ? (message.content as Part[]) : [];
}

/** The newest Student message's parts, without the tutor context. */
function lastUserParts(prompt: Prompt): Part[] {
  return lastUserContent(prompt).filter((part) => !isContext(part));
}

/** The tutor context in front of the newest Student message, or "". */
function tutorContextText(prompt: Prompt): string {
  return lastUserContent(prompt).find(isContext)?.text ?? "";
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

/** A Student's message that starts with this makes the tutor mock ask. */
export const MOCK_QUIZ_REQUEST = "Quiz me";

/**
 * A Student's message that starts with this makes the tutor mock open the
 * first Reading section the instructions list.
 */
export const MOCK_READING_REQUEST = "Read with me";

/** The purpose question of the tutor mock's reading. */
export const MOCK_READING_PURPOSE = "Mock purpose: what makes thrust?";

/** The question the tutor mock asks. */
export const MOCK_QUESTION = "Mock question: what is $2 + 2$?";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** One tool call as a whole streamed step. */
function toolCallStream(id: string, toolName: string, input: unknown) {
  return simulateReadableStream({
    initialDelayInMs: null,
    chunkDelayInMs: null,
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      {
        type: "tool-call" as const,
        toolCallId: id,
        toolName,
        input: JSON.stringify(input),
      },
      {
        type: "finish" as const,
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
      },
    ],
  });
}

type ToolPart = {
  type: string;
  toolName?: string;
  input?: unknown;
  output?: { type?: string };
};

/**
 * The KCs of the question the reply before the Student's last message
 * asked, when the ask succeeded and no grade followed: the one that message
 * answers.
 */
function openQuestion(prompt: Prompt): { kcIds: string[] } | undefined {
  let asked = false;
  for (const message of prompt.toReversed().slice(1)) {
    if (message.role === "user") return undefined;
    if (!Array.isArray(message.content)) continue;
    for (const part of (message.content as ToolPart[]).toReversed()) {
      if (part.type === "tool-result" && part.toolName === "grade") {
        return undefined;
      }
      if (part.type === "tool-result" && part.toolName === "ask") {
        asked = part.output?.type !== "error-text";
      }
      if (part.type === "tool-call" && part.toolName === "ask") {
        const input = (
          typeof part.input === "string" ? JSON.parse(part.input) : part.input
        ) as { kcIds?: string[] };
        return asked ? { kcIds: input.kcIds ?? [] } : undefined;
      }
    }
  }
  return undefined;
}

/**
 * In a Chat, the tutor's questions and readings: a Student message starting
 * with "Quiz me" gets an `ask` call on the first KC id the tutor context
 * names, one starting with "Read with me" a `showReading` call on the first
 * Reading section it names, and any other message right after an `ask` a
 * `grade` call with every KC of the asked question full. Each then ends its
 * step.
 */
function mockTutorQuestions(
  prompt: Prompt,
  tools: ReadonlyArray<{ name: string }> | undefined,
) {
  if (!tools?.some(({ name }) => name === "ask")) return null;
  if (prompt.at(-1)?.role !== "user") return null;
  const text = lastUserParts(prompt)
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ");
  const answered =
    !text.startsWith(MOCK_QUIZ_REQUEST) &&
    !text.startsWith(MOCK_READING_REQUEST) &&
    openQuestion(prompt);
  if (answered) {
    return toolCallStream("mock-grade", "grade", {
      results: answered.kcIds.map((kcId) => ({ kcId, result: "full" })),
      help: "none",
    });
  }
  const context = tutorContextText(prompt);
  if (text.startsWith(MOCK_READING_REQUEST)) {
    const sectionId = new RegExp(`section id (${UUID})`).exec(context)?.[1];
    if (!sectionId) return null;
    return toolCallStream("mock-show-reading", "showReading", {
      sectionId,
      purpose: MOCK_READING_PURPOSE,
    });
  }
  if (!text.startsWith(MOCK_QUIZ_REQUEST)) return null;
  const kcId = new RegExp(`KC id (${UUID})`).exec(context)?.[1];
  if (!kcId) return null;
  return toolCallStream("mock-ask", "ask", {
    prompt: MOCK_QUESTION,
    kcIds: [kcId],
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
      responseFormat,
    }: {
      prompt: Prompt;
      tools?: ReadonlyArray<{ name: string }>;
      responseFormat?: ResponseFormat;
    }) => ({
      stream:
        mockTutorQuestions(prompt, tools) ??
        simulateReadableStream({
          initialDelayInMs: null,
          // Structured output streams at once: no Student watches it.
          chunkDelayInMs:
            responseFormat?.type === "json" ? null : WORD_DELAY_MS,
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "text-1" },
            ...mockText(prompt, responseFormat)
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
