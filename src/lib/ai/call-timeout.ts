/**
 * How long a model call made by a workflow step may take, and when a step
 * may still start one. A Vercel function ends after 300 seconds, so a step
 * starts no call, first or retry, that could run past STEP_LIMIT_MS.
 */

/** The time limit of every model call a workflow step makes. */
export const CALL_TIMEOUT_MS = 170_000;

/** How long a step may run, with a margin under Vercel's 300 seconds. */
export const STEP_LIMIT_MS = 290_000;

/**
 * Whether a step that started at `stepStartedAt` (from `Date.now()`) may
 * start a call now: one that times out still ends before STEP_LIMIT_MS.
 */
export function callFits(stepStartedAt: number, now = Date.now()): boolean {
  return now - stepStartedAt + CALL_TIMEOUT_MS < STEP_LIMIT_MS;
}

/** The error of a model call that ran into CALL_TIMEOUT_MS. */
export class CallTimeoutError extends Error {
  constructor(traceName: string) {
    super(`The ${traceName} call timed out after ${CALL_TIMEOUT_MS} ms.`);
    this.name = "CallTimeoutError";
  }
}

/**
 * Whether `error` is the AI SDK's abort for a passed `timeout`: a
 * `TimeoutError`, as `AbortSignal.timeout` gives, possibly as the cause.
 */
export function isTimeoutError(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && depth < 4; depth += 1) {
    if (cause instanceof Error || cause instanceof DOMException) {
      if (cause.name === "TimeoutError") return true;
      cause = (cause as { cause?: unknown }).cause;
    } else return false;
  }
  return false;
}
