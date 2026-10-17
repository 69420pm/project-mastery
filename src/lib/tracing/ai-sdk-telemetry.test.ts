// @vitest-environment node
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { embedMany, generateText } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";
import { langfuseAiSdkTelemetry } from "./ai-sdk-telemetry";

/** AI SDK spans as the Langfuse span processor would receive them. */
function tracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const telemetry = langfuseAiSdkTelemetry(provider.getTracer("ai"));
  return { exporter, integrations: [telemetry] };
}

const LANGFUSE_INPUT = "langfuse.observation.input";

test("an embedding call's span carries its values as the Langfuse input, without the vectors", async () => {
  const { exporter, integrations } = tracing();
  const model = new MockEmbeddingModelV4({
    // One call for both values, as the Gemini API batches them.
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => [0.5, 0.5]),
      usage: undefined,
      warnings: [],
    }),
  });

  await embedMany({
    model,
    values: ["Alpha.", "Beta."],
    telemetry: { functionId: "embed", integrations },
  });

  const spans = exporter.getFinishedSpans();
  const call = spans.find((span) => span.name.startsWith("embeddings "));
  expect(JSON.parse(String(call?.attributes[LANGFUSE_INPUT]))).toEqual([
    "Alpha.",
    "Beta.",
  ]);
  for (const span of spans) {
    expect(JSON.stringify(span.attributes)).not.toContain("0.5");
  }
});

/** A model that answers once, with cache reads and what AI Gateway reports. */
function cachedModel(
  providerMetadata?: Record<string, Record<string, string>>,
) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "OK" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 6187,
          noCache: 11,
          cacheRead: 6176,
          cacheWrite: undefined,
        },
        outputTokens: { total: 2, text: 2, reasoning: undefined },
      },
      providerMetadata,
      warnings: [],
    }),
  });
}

const USAGE_DETAILS = "langfuse.observation.usage_details";
const COST_DETAILS = "langfuse.observation.cost_details";

test("a model call's span has its cache reads as usage and the gateway's cost", async () => {
  const { exporter, integrations } = tracing();

  await generateText({
    model: cachedModel({
      gateway: {
        cost: "0.0000184231",
        inputInferenceCost: "0.0000177581",
        outputInferenceCost: "0.000000665",
      },
    }),
    prompt: "Hello",
    telemetry: { integrations },
  });

  const call = exporter
    .getFinishedSpans()
    .find((span) => span.attributes["gen_ai.operation.name"] === "chat");
  expect(JSON.parse(String(call?.attributes[USAGE_DETAILS]))).toEqual({
    input: 11,
    input_cached_tokens: 6176,
    output: 2,
  });
  expect(JSON.parse(String(call?.attributes[COST_DETAILS]))).toEqual({
    input: 0.0000177581,
    output: 0.000000665,
    total: 0.0000184231,
  });
});

test("a model call without a reported cost leaves it for Langfuse to infer", async () => {
  const { exporter, integrations } = tracing();

  await generateText({
    model: cachedModel(),
    prompt: "Hello",
    telemetry: { integrations },
  });

  const spans = exporter.getFinishedSpans();
  const call = spans.find(
    (span) => span.attributes["gen_ai.operation.name"] === "chat",
  );
  expect(call?.attributes[USAGE_DETAILS]).toBeDefined();
  for (const span of spans) {
    expect(span.attributes[COST_DETAILS]).toBeUndefined();
  }
});

test("other calls get no input from an embedding call", async () => {
  const { exporter, integrations } = tracing();
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Hi." }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });

  await embedMany({
    model: new MockEmbeddingModelV4({
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => [0.5]),
        usage: undefined,
        warnings: [],
      }),
    }),
    values: ["Alpha."],
    telemetry: { integrations },
  });
  exporter.reset();
  await generateText({ model, prompt: "Hello", telemetry: { integrations } });

  for (const span of exporter.getFinishedSpans()) {
    expect(span.attributes[LANGFUSE_INPUT]).toBeUndefined();
  }
});
