import type { APICallError } from "ai";

/**
 * How long a provider asks to wait before calling again after `error`, in
 * milliseconds, or undefined when it does not say. Reads the `retry-after-ms`
 * and `retry-after` headers (AI Gateway), then the `RetryInfo` detail of a
 * Gemini API error body, which sends no headers (see docs/agents/live-ai.md):
 * `"retryDelay": "21s"`.
 */
export function retryDelayMs(error: APICallError): number | undefined {
  const headers = error.responseHeaders ?? {};
  const fromHeaders = [
    Number.parseFloat(headers["retry-after-ms"] ?? ""),
    Number.parseFloat(headers["retry-after"] ?? "") * 1000,
  ].find((ms) => Number.isFinite(ms) && ms >= 0);
  return fromHeaders ?? geminiRetryDelayMs(error.responseBody);
}

type GeminiErrorBody = {
  error?: { details?: Array<{ "@type"?: string; retryDelay?: string }> };
};

function geminiRetryDelayMs(body: string | undefined): number | undefined {
  let parsed: GeminiErrorBody;
  try {
    parsed = JSON.parse(body ?? "") as GeminiErrorBody;
  } catch {
    return undefined;
  }
  const retryInfo = parsed.error?.details?.find((detail) =>
    detail["@type"]?.endsWith("google.rpc.RetryInfo"),
  );
  const seconds = Number.parseFloat(retryInfo?.retryDelay ?? "");
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
