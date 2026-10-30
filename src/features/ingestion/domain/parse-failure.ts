/**
 * The reasons a Student sees for a failed parse, next to "Failed" on the
 * Materials page. Short and plain: what went wrong, not how.
 */

/** The Student's Daily limit, or the provider's daily quota, is used up. */
export const dailyLimitReason = "Daily limit reached";

/** The file could not be downloaded or opened as a PDF. */
export const fileUnreadableReason = "The file could not be opened";

/**
 * A queued or parsing Material no parse step touched for PARSE_LEASE_MINUTES:
 * its workflow died. `queue_material_parse` and `queue_knowledge_map_build`
 * treat it as failed with this reason.
 */
export const parseStoppedReason = "The parse stopped. Parse again.";

/** How long a parse may go without a heartbeat before it counts as stopped. */
export const PARSE_LEASE_MINUTES = 30;

/** Any other step failed for good, such as a Database or Storage failure. */
const parseFailedReason = "The material could not be parsed. Please try again.";

const REASON_PREFIX = "Parse failure: ";

/**
 * An error a step throws when it knows the Student's reason: the file or the
 * page call is at fault. The reason travels in the message, which the
 * workflow runtime keeps when it hands a step's error to the workflow.
 */
export function parseFailureError(reason: string): Error {
  return new Error(`${REASON_PREFIX}${reason}`);
}

/**
 * The Student's reason for a parse that failed with `error`: the one a step
 * gave, or the general reason for any other error.
 */
export function parseFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith(REASON_PREFIX)
    ? message.slice(REASON_PREFIX.length)
    : parseFailedReason;
}
