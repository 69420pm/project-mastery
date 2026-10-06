import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";
import { isVercelDeployment } from "@/lib/deployment-env";
import { getTracingEnvironment, isLangfuseConfigured } from "./env";

/**
 * Sends AI SDK spans to Langfuse through OpenTelemetry (ARCHITECTURE decision
 * 12). Node.js runtime only. Without Langfuse keys nothing is registered, so
 * AI calls emit no telemetry at all.
 *
 * Returns the provider so short-lived processes (evals) can shut it down.
 */
export function startTracing(): NodeTracerProvider | undefined {
  if (!isLangfuseConfigured()) return undefined;

  const provider = new NodeTracerProvider({
    spanProcessors: [
      // Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL.
      // By default it exports only LLM spans, not Next.js request spans.
      new LangfuseSpanProcessor({
        // Serverless functions freeze after the response: export every span
        // right away instead of batching. Routes also call `flushTraces`.
        exportMode: isVercelDeployment() ? "immediate" : "batched",
        environment: getTracingEnvironment(),
      }),
    ],
  });
  provider.register();
  // AI SDK 7 emits telemetry only through registered integrations.
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  return provider;
}
