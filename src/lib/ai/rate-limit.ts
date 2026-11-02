import { RetryError } from "ai";

/** The wait when the Gateway's message names none, in milliseconds. */
const DEFAULT_WAIT_MS = 60_000;

/**
 * How long to wait before calling again after the AI Gateway's per-minute
 * rate limit (`GatewayRateLimitError`, no `APICallError`), in milliseconds,
 * or null when `error` is another one. The wait is the one its message
 * names: "Retry after 20s."
 */
export function gatewayRateLimitWaitMs(error: unknown): number | null {
  if (RetryError.isInstance(error)) {
    return gatewayRateLimitWaitMs(error.lastError);
  }
  if (!(error instanceof Error) || error.name !== "GatewayRateLimitError") {
    return null;
  }
  const seconds = Number.parseFloat(
    /retry after (\d+(?:\.\d+)?)s/i.exec(error.message)?.[1] ?? "",
  );
  return Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_WAIT_MS;
}
