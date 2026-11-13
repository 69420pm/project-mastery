import "server-only";
import { RetryableError } from "workflow";
import type { z } from "zod";
import { meteredStream } from "@/features/usage/server";
import { BUILD_CALL_TIMEOUT_MS, CallTimeoutError } from "@/lib/ai/call-timeout";
import type { AdminSupabase } from "@/lib/supabase/types";

/** The least wait after the Gateway's rate limit turned a build call away. */
export const MIN_RATE_LIMIT_WAIT_MS = 60_000;

/**
 * A build call the Gateway's per-minute rate limit turned away: its unit is
 * neither answered nor failed, and is called again after `waitMs` (at least
 * MIN_RATE_LIMIT_WAIT_MS). `error` is the step's retry, for a step with
 * nothing answered to keep.
 */
export class RateLimited {
  constructor(
    readonly waitMs: number,
    readonly error: RetryableError,
  ) {}
}

/**
 * One structured call of the build, streamed and metered, its answer
 * parsed with `schema`. It ends after BUILD_CALL_TIMEOUT_MS, or the shorter
 * `timeoutMs` of a retry, and sends no SDK retries: a unit waits out a
 * rate limit instead. "failed" when the call timed out or its answer is no
 * valid output: the caller leaves its unit to the next step. "limit" when
 * the Daily limit is reached. `RateLimited` when the Gateway's rate limit
 * turned the call away.
 */
export async function buildCall<Schema extends z.ZodType>(
  supabase: AdminSupabase,
  scope: Parameters<typeof meteredStream>[1],
  call: Parameters<typeof meteredStream>[2],
  schema: Schema,
  timeoutMs = BUILD_CALL_TIMEOUT_MS,
): Promise<z.infer<Schema> | "limit" | "failed" | RateLimited> {
  let result: Awaited<ReturnType<typeof meteredStream>>;
  try {
    result = await meteredStream(supabase, scope, {
      ...call,
      maxRetries: 0,
      timeout: { totalMs: timeoutMs },
    });
  } catch (error) {
    // `meteredStream` turns only the Gateway's rate limit into a retry.
    if (RetryableError.is(error)) {
      const waitMs = Math.max(
        MIN_RATE_LIMIT_WAIT_MS,
        error.retryAfter.getTime() - Date.now(),
      );
      console.warn(
        `The ${scope.traceName} call met the rate limit; its unit waits ${Math.round(waitMs / 1000)} s.`,
      );
      return new RateLimited(waitMs, error);
    }
    if (!(error instanceof CallTimeoutError)) throw error;
    console.warn(error.message);
    return "failed";
  }
  if (!result) return "limit";
  try {
    return schema.parse(await result.output);
  } catch {
    console.warn(`The ${scope.traceName} call gave no valid answer.`);
    return "failed";
  }
}
