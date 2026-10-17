import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import {
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import type { Telemetry } from "ai";

type CallEnd = Parameters<
  LangfuseVercelAiSdkIntegration["onLanguageModelCallEnd"]
>[0];

/**
 * The AI SDK telemetry integration that sends AI calls to Langfuse, with two
 * additions to what Langfuse's integration records:
 *
 * - **Embedding values as input.** `@ai-sdk/otel` writes them only with its
 *   `embedding` option, which Langfuse does not pass, and Langfuse shows the
 *   `ai.values` they would go to as metadata, not as input. The vectors (3072
 *   numbers per chunk) stay out. The values are set as
 *   `langfuse.observation.input` when the call's span starts, which
 *   `@ai-sdk/otel` does synchronously inside `onEmbedStart`.
 * - **Cache reads and the gateway's cost on model calls.** Langfuse files
 *   `gen_ai.usage.cache_read.input_tokens` under metadata, so a call that read
 *   its prompt from the cache was priced as all fresh input (47 times too high
 *   for a MiMo call that read 99.8% of its input). The span gets
 *   `langfuse.observation.usage_details` with the cache reads apart, and
 *   `langfuse.observation.cost_details` from the cost AI Gateway reports with
 *   the answer, which Langfuse prefers over the price it infers. Calls
 *   without a reported cost keep the inferred one. Both are set when the
 *   call's span ends, which `@ai-sdk/otel` does synchronously inside
 *   `onLanguageModelCallEnd`.
 */
export function langfuseAiSdkTelemetry(
  tracer: Tracer = trace.getTracer("ai"),
): Telemetry {
  let embedding: string[] | undefined;
  let call: CallEnd | undefined;
  const integration = new LangfuseVercelAiSdkIntegration({
    tracer: withAttributes(
      tracer,
      () => embedding,
      () => call,
    ),
  });
  const onEmbedStart = integration.onEmbedStart.bind(integration);
  integration.onEmbedStart = (event) => {
    embedding = event.values;
    try {
      onEmbedStart(event);
    } finally {
      embedding = undefined;
    }
  };
  const onLanguageModelCallEnd =
    integration.onLanguageModelCallEnd.bind(integration);
  integration.onLanguageModelCallEnd = (event) => {
    call = event;
    try {
      onLanguageModelCallEnd(event);
    } finally {
      call = undefined;
    }
  };
  return integration;
}

/**
 * `tracer`, giving a span started while `input()` has values that input, and
 * a model call's span the usage and cost of the call `ending()` has when it
 * ends.
 */
function withAttributes(
  tracer: Tracer,
  input: () => string[] | undefined,
  ending: () => CallEnd | undefined,
): Tracer {
  return {
    startSpan(name, options, context) {
      const values = input();
      const span = tracer.startSpan(
        name,
        values === undefined
          ? options
          : {
              ...options,
              attributes: {
                ...options?.attributes,
                [LangfuseOtelSpanAttributes.OBSERVATION_INPUT]:
                  JSON.stringify(values),
              },
            },
        context,
      );
      return options?.attributes?.["gen_ai.operation.name"] === "chat"
        ? withCallAttributes(span, ending)
        : span;
    },
    startActiveSpan: tracer.startActiveSpan.bind(
      tracer,
    ) as Tracer["startActiveSpan"],
  };
}

/** `span`, which gets the attributes of the ending call when it ends. */
function withCallAttributes(
  span: Span,
  ending: () => CallEnd | undefined,
): Span {
  return new Proxy(span, {
    get(target, property) {
      if (property === "end") {
        return (endTime?: Parameters<Span["end"]>[0]) => {
          const event = ending();
          if (event) target.setAttributes(callAttributes(event));
          target.end(endTime);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function callAttributes({ usage, providerMetadata }: CallEnd): Attributes {
  const attributes: Attributes = {};
  if (usage.inputTokens !== undefined) {
    const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    attributes[LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS] =
      JSON.stringify({
        input: usage.inputTokens - cacheRead,
        ...(cacheRead > 0 && { input_cached_tokens: cacheRead }),
        output: usage.outputTokens ?? 0,
      });
  }
  const gateway = providerMetadata?.gateway;
  const total = usd(gateway?.cost);
  if (total !== undefined) {
    const input = usd(gateway?.inputInferenceCost);
    const output = usd(gateway?.outputInferenceCost);
    attributes[LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS] =
      JSON.stringify(
        input !== undefined && output !== undefined
          ? { input, output, total }
          : { total },
      );
  }
  return attributes;
}

/** An amount in US dollars as AI Gateway sends it, a string, if it is one. */
function usd(value: unknown): number | undefined {
  const amount = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : undefined;
}
