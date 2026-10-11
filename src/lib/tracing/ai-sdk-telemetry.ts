import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { trace, type Tracer } from "@opentelemetry/api";
import type { Telemetry } from "ai";

/**
 * The AI SDK telemetry integration that sends AI calls to Langfuse, with
 * each embedding call's values as its Langfuse input.
 *
 * Langfuse's integration records no embedding values: `@ai-sdk/otel` writes
 * them only with its `embedding` option, which Langfuse does not pass, and
 * Langfuse shows the `ai.values` they would go to as metadata, not as input.
 * The vectors (3072 numbers per chunk) stay out. The values are set as
 * `langfuse.observation.input` when the call's span starts, which
 * `@ai-sdk/otel` does synchronously inside `onEmbedStart`.
 */
export function langfuseAiSdkTelemetry(
  tracer: Tracer = trace.getTracer("ai"),
): Telemetry {
  let embedding: string[] | undefined;
  const integration = new LangfuseVercelAiSdkIntegration({
    tracer: withInput(tracer, () => embedding),
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
  return integration;
}

/** `tracer`, giving a span started while `input()` has values that input. */
function withInput(tracer: Tracer, input: () => string[] | undefined): Tracer {
  return {
    startSpan(name, options, context) {
      const values = input();
      if (values === undefined) return tracer.startSpan(name, options, context);
      return tracer.startSpan(
        name,
        {
          ...options,
          attributes: {
            ...options?.attributes,
            [LangfuseOtelSpanAttributes.OBSERVATION_INPUT]:
              JSON.stringify(values),
          },
        },
        context,
      );
    },
    startActiveSpan: tracer.startActiveSpan.bind(
      tracer,
    ) as Tracer["startActiveSpan"],
  };
}
