/**
 * How long a model call made by a workflow step may take, and when a step
 * may still start one. A Vercel function ends after 300 seconds, so a step
 * starts no call, first or retry, that could run past STEP_LIMIT_MS.
 */

/** The time limit of a model call a workflow step makes by default. */
export const CALL_TIMEOUT_MS = 170_000;

/**
 * The time limit of a Knowledge map build's calls: nearly the whole step,
 * since a slow model needs it for a unit. A step starts them only in its
 * first seconds, all at once, and leaves the rest to the next step.
 */
export const BUILD_CALL_TIMEOUT_MS = 260_000;

/** How long a step may run, with a margin under Vercel's 300 seconds. */
export const STEP_LIMIT_MS = 290_000;

/** The shortest time a retry made with what is left of a step gets. */
const MIN_RETRY_MS = 60_000;

/**
 * Whether a step that started at `stepStartedAt` (from `Date.now()`) may
 * start a call with this time limit now: one that times out still ends
 * before STEP_LIMIT_MS.
 */
export function callFits(
  stepStartedAt: number,
  timeoutMs = CALL_TIMEOUT_MS,
  now = Date.now(),
): boolean {
  return now - stepStartedAt + timeoutMs < STEP_LIMIT_MS;
}

/**
 * The time limit of a retry a step makes with what is left of it: the
 * time to STEP_LIMIT_MS, at most `timeoutMs`; null when less than
 * MIN_RETRY_MS is left.
 */
export function retryTimeoutMs(
  stepStartedAt: number,
  timeoutMs = BUILD_CALL_TIMEOUT_MS,
  now = Date.now(),
): number | null {
  const left = Math.min(timeoutMs, STEP_LIMIT_MS - (now - stepStartedAt));
  return left >= MIN_RETRY_MS ? left : null;
}

/** The error of a model call that ran into its time limit. */
export class CallTimeoutError extends Error {
  constructor(traceName: string) {
    super(`The ${traceName} call timed out.`);
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
