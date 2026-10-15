/**
 * The reasons a Student sees for a failed Knowledge map build. Short and
 * plain: what went wrong, not how.
 */

/** The Student's Daily limit, or the provider's daily quota, is used up. */
export const dailyLimitReason = "Daily limit reached";

/** The parsed Materials have no chunk that teaches anything. */
export const nothingToMapReason = "The parsed materials have nothing to map";

/** Any step failed for good, such as a model or Database failure. */
export const buildFailedReason =
  "The knowledge map could not be built. Please try again.";
