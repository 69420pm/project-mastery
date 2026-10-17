import { isDefaultExportSpan } from "@langfuse/otel";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";

/**
 * The AI SDK wraps every call in an `invoke_agent` span and each of its steps
 * in an `agent_step` span. They only group the model and tool spans and carry
 * nothing of their own, but each is a billable Langfuse unit (3 per call
 * instead of 1). The model and tool spans stay and keep their `parent` ids;
 * Langfuse lists them under the trace.
 */
const WRAPPER_OPERATIONS = ["invoke_agent", "agent_step"];

/** Whether the Langfuse span processor should export `otelSpan`. */
export function shouldExportSpan({
  otelSpan,
}: {
  otelSpan: ReadableSpan;
}): boolean {
  return (
    isDefaultExportSpan(otelSpan) &&
    !WRAPPER_OPERATIONS.includes(
      String(otelSpan.attributes["gen_ai.operation.name"]),
    )
  );
}
