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
