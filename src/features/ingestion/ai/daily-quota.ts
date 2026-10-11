import { APICallError, RetryError } from "ai";

/**
 * Whether a model call failed because the provider's daily request quota is
 * used up: a 429 whose body names a per-day quota. Waiting does not clear it
 * before the daily reset, so a parse stops instead of retrying. A per-minute
 * 429 is not one; the step's retries outlast it.
 */
export function isDailyQuotaError(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isDailyQuotaError(error.lastError);
  return (
    APICallError.isInstance(error) &&
    error.statusCode === 429 &&
    /per\s*day|daily/i.test(error.responseBody ?? "")
  );
}
