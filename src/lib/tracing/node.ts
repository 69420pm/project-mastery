import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";
import { isVercelDeployment } from "@/lib/deployment-env";
import { langfuseAiSdkTelemetry } from "./ai-sdk-telemetry";
import { getTracingEnvironment, isTracingEnabled } from "./env";
import { shouldExportSpan } from "./export-filter";

/**
 * Sends AI SDK spans to Langfuse through OpenTelemetry (ARCHITECTURE decision
 * 12). Node.js runtime only. Without Langfuse keys, or with the mock provider,
 * nothing is registered, so AI calls emit no telemetry at all.
 *
 * Returns the provider so short-lived processes (evals) can shut it down.
 */
export function startTracing(): NodeTracerProvider | undefined {
  if (!isTracingEnabled()) return undefined;

  const provider = new NodeTracerProvider({
    spanProcessors: [
      // Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL.
      // It exports only LLM spans, not Next.js request spans, and not the AI
      // SDK's grouping spans (see export-filter.ts).
      new LangfuseSpanProcessor({
        shouldExportSpan,
        // Serverless functions freeze after the response: export every span
        // right away instead of batching. Routes also call `flushTraces`.
        exportMode: isVercelDeployment() ? "immediate" : "batched",
        environment: getTracingEnvironment(),
      }),
    ],
  });
  provider.register();
  // AI SDK 7 emits telemetry only through registered integrations.
  registerTelemetry(langfuseAiSdkTelemetry());
  return provider;
}
