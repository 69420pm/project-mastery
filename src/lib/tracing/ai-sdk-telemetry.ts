import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { isTimeoutError } from "@/lib/ai/call-timeout";
import {
  SpanStatusCode,
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
 * The AI SDK telemetry integration that sends AI calls to Langfuse, with
 * three additions to what Langfuse's integration records:
 *
 * - **Embedding values as input.** `@ai-sdk/otel` writes them only with its
 *   `embedding` option, which Langfuse does not pass, and Langfuse shows the
 *   `ai.values` they would go to as metadata, not as input. The vectors (2048
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
 * - **Timed-out calls as errors.** `@ai-sdk/otel` ends the spans of an
 *   aborted call without a status. When the abort is the call's `timeout`,
 *   each span it ends synchronously inside `onAbort` gets the level ERROR
 *   and the timeout's message.
 */
export function langfuseAiSdkTelemetry(
  tracer: Tracer = trace.getTracer("ai"),
): Telemetry {
  let embedding: string[] | undefined;
  let call: CallEnd | undefined;
  let timedOut: string | undefined;
  const integration = new LangfuseVercelAiSdkIntegration({
    tracer: withAttributes(tracer, {
      input: () => embedding,
      ending: () => call,
      timedOut: () => timedOut,
    }),
  });
  const onAbort = integration.onAbort.bind(integration);
  integration.onAbort = (event) => {
    timedOut = isTimeoutError(event.reason)
      ? (event.reason as Error).message
      : undefined;
    try {
      onAbort(event);
    } finally {
      timedOut = undefined;
    }
  };
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
 * `tracer`, giving a span started while `input()` has values that input, a
 * model call's span the usage and cost of the call `ending()` has when it
 * ends, and any span that ends while `timedOut()` gives a message (a call
 * aborted by its `timeout`) the level ERROR with that message.
 */
function withAttributes(
  tracer: Tracer,
  {
    input,
    ending,
    timedOut,
  }: {
    input: () => string[] | undefined;
    ending: () => CallEnd | undefined;
    timedOut: () => string | undefined;
  },
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
      const isCall = options?.attributes?.["gen_ai.operation.name"] === "chat";
      return withEndAttributes(span, () => {
        const message = timedOut();
        if (message !== undefined) {
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          return {
            [LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]: "ERROR",
            [LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE]: message,
          };
        }
        const event = isCall ? ending() : undefined;
        return event ? callAttributes(event) : undefined;
      });
    },
    startActiveSpan: tracer.startActiveSpan.bind(
      tracer,
    ) as Tracer["startActiveSpan"],
  };
}

/** `span`, which gets the attributes `atEnd` gives when it ends. */
function withEndAttributes(
  span: Span,
  atEnd: () => Attributes | undefined,
): Span {
  return new Proxy(span, {
    get(target, property) {
      if (property === "end") {
        return (endTime?: Parameters<Span["end"]>[0]) => {
          const attributes = atEnd();
          if (attributes) target.setAttributes(attributes);
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
