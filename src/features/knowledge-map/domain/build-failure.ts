/**
 * The reasons a Student sees for a failed Knowledge map build. Short and
 * plain: what went wrong, not how.
 */

/** The build had no heartbeat for BUILD_LEASE_MINUTES. */
export const buildStoppedReason = "The build stopped. Update the map again.";

/**
 * How long a build may go without a heartbeat before it counts as failed,
 * as `public.queue_knowledge_map_build` treats it.
 */
export const BUILD_LEASE_MINUTES = 30;

/** Any step failed for good, such as a model or Database failure. */
export const buildFailedReason =
  "The knowledge map could not be built. Please try again.";
