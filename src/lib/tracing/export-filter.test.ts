// @vitest-environment node
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { generateText, isStepCount, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";
import { z } from "zod";
import { langfuseAiSdkTelemetry } from "./ai-sdk-telemetry";
import { shouldExportSpan } from "./export-filter";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

test("a tool-calling AI call exports its model and tool spans, not the grouping spans", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls++;
      return calls === 1
        ? {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "1",
                toolName: "lookup",
                input: "{}",
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: "tool" },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: "text" as const, text: "done" }],
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage,
            warnings: [],
          };
    },
  });

  await generateText({
    model,
    prompt: "hi",
    tools: {
      lookup: tool({
        description: "Looks something up.",
        inputSchema: z.object({}),
        execute: async () => "found",
      }),
    },
    stopWhen: isStepCount(3),
    telemetry: {
      functionId: "test",
      integrations: [langfuseAiSdkTelemetry(provider.getTracer("ai"))],
    },
  });

  const exported = exporter
    .getFinishedSpans()
    .filter((otelSpan) => shouldExportSpan({ otelSpan }))
    .map((span) => String(span.attributes["gen_ai.operation.name"]))
    .sort();

  expect(exported).toEqual(["chat", "chat", "execute_tool"]);
});
